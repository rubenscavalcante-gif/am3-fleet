const tokenKey = "fleetdesk-token";
const apiBases = [
  "",
  "http://127.0.0.1:4175",
  "http://127.0.0.1:4174"
];
let apiBase = window.location.protocol === "https:" ? "" : localStorage.getItem("fleetdesk-api-base") || "";

const titles = {
  dashboard: "Painel da frota",
  reception: "Recepção",
  schedule: "Agendamentos",
  quickExits: "Saídas rápidas",
  mobile: "Modo motorista",
  vehicles: "Veículos",
  drivers: "Motoristas",
  fuel: "Abastecimentos",
  maintenance: "Manutenção",
  release: "Liberação de veículos",
  checklists: "Checklists",
  documents: "Documentos",
  expirations: "Vencimentos",
  users: "Usuários",
  audit: "Auditoria",
  system: "Sistema",
  reports: "Relatórios"
};

let data = {
  vehicles: [],
  drivers: [],
  bookings: [],
  quickExits: [],
  fuel: [],
  maintenance: [],
  checklists: [],
  documents: [],
  auditLogs: [],
  users: []
};
let authToken = localStorage.getItem(tokenKey) || "";
let searchTerm = "";
let currentUser = null;
let closingQuickExitId = null;
let systemStatus = null;
let lastAutoRefreshAt = 0;
let eventSource = null;
const editing = {};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

document.addEventListener("DOMContentLoaded", async () => {
  registerServiceWorker();
  wireNavigation();
  wireForms();
  wireActions();
  wireSearchAndGlobalActions();
  wireAutoRefresh();
  setDefaultDates();

  if (authToken) {
    await startAuthenticatedApp();
  } else {
    showLogin();
  }
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol !== "https:") return;
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

function wireAutoRefresh() {
  window.setInterval(() => autoRefreshData(), 20000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) autoRefreshData(true);
  });
  window.addEventListener("focus", () => autoRefreshData(true));
}

function connectRealtimeEvents() {
  if (!authToken || typeof EventSource === "undefined") return;
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`${apiBase || ""}/api/events?token=${encodeURIComponent(authToken)}`);
  eventSource.addEventListener("data-changed", () => autoRefreshData(true));
  eventSource.addEventListener("error", () => {
    eventSource?.close();
    eventSource = null;
    if (authToken) window.setTimeout(connectRealtimeEvents, 5000);
  });
}

function wireNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
      button.classList.add("active");
      document.getElementById(button.dataset.view).classList.add("active-view");
      document.getElementById("viewTitle").textContent = titles[button.dataset.view];
    });
  });
}

function wireActions() {
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());

    try {
      const result = await api("/api/login", { method: "POST", body: values, skipAuth: true });
      authToken = result.token;
      currentUser = result.user;
      localStorage.setItem(tokenKey, authToken);
      await startAuthenticatedApp();
      toast(`Bem-vindo, ${result.user.name}.`);
    } catch (error) {
      toast(error.message);
    }
  });

  document.getElementById("logoutButton").addEventListener("click", async () => {
    await logout();
  });
  document.getElementById("mobileLogoutButton")?.addEventListener("click", async () => {
    await logout();
  });
}

async function logout() {
    try {
      await api("/api/logout", { method: "POST" });
    } catch {
      // Logout local ainda deve funcionar se a sessão já expirou.
    }
    authToken = "";
    currentUser = null;
    localStorage.removeItem(tokenKey);
    eventSource?.close();
    eventSource = null;
    showLogin();
}

function wireSearchAndGlobalActions() {
  document.getElementById("globalSearch").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim().toLowerCase();
    renderAll();
  });

  document.getElementById("resetData").addEventListener("click", async () => {
    try {
      data = await api("/api/reset", { method: "POST" });
      renderAll();
      toast("Dados de demonstração restaurados.");
    } catch (error) {
      toast(error.message);
    }
  });

  document.getElementById("exportData").addEventListener("click", exportCsv);
  document.querySelectorAll("[data-print-report]").forEach((button) => {
    button.addEventListener("click", () => printReport(button.dataset.printReport));
  });
  document.querySelectorAll("[data-go-view]").forEach((button) => {
    button.addEventListener("click", () => navigateTo(button.dataset.goView));
  });
  document.querySelector('#documentForm select[name="ownerType"]').addEventListener("change", renderDocumentOwners);
  ["reportStart", "reportEnd", "reportVehicle", "reportDriver"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", renderReports);
  });
  document.getElementById("cancelQuickExitClose").addEventListener("click", closeSettlementModal);
  document.getElementById("quickExitCloseForm").addEventListener("input", updateSettlementTotals);
  document.getElementById("quickExitCloseForm").addEventListener("submit", submitQuickExitSettlement);
  document.getElementById("mobileCheckoutForm")?.addEventListener("submit", submitMobileCheckout);
  document.getElementById("refreshSystemStatus")?.addEventListener("click", refreshSystemStatus);
  document.getElementById("runBackup")?.addEventListener("click", runBackup);
  document.querySelectorAll("[data-receipt-target]").forEach((input) => {
    input.addEventListener("change", () => uploadReceiptFile(input));
  });
}

function wireForms() {
  bindForm("vehicleForm", async (values, form) => {
    const vehicleId = editing[form.id];
    const payload = {
      plate: values.plate.toUpperCase(),
      model: values.model,
      year: Number(values.year),
      status: values.status,
      costCenter: values.costCenter
    };

    if (vehicleId && payload.status === "Disponível") {
      const openMaintenance = data.maintenance.filter((item) => item.vehicleId === vehicleId && item.status !== "Concluída");
      if (openMaintenance.length) {
        const confirmed = window.confirm(`Este veículo possui ${openMaintenance.length} manutenção(ões) aberta(s). Deseja concluir essas manutenções e liberar o veículo?`);
        if (!confirmed) {
          toast("Para liberar o veículo, conclua as manutenções abertas.");
          return;
        }

        for (const item of openMaintenance) {
          await api(`/api/maintenance/${item.id}`, {
            method: "PUT",
            body: { ...item, status: "Concluída" }
          });
        }
      }
    }

    await createRecord("vehicles", payload, form, "Veículo cadastrado.");
  });

  bindForm("driverForm", async (values, form) => {
    await createRecord("drivers", {
      name: values.name,
      phone: values.phone,
      license: values.license,
      licenseDue: values.licenseDue,
      status: values.status,
      department: values.department
    }, form, "Motorista cadastrado.");
  });

  bindForm("bookingForm", async (values, form) => {
    if (new Date(values.end) <= new Date(values.start)) {
      toast("A data final precisa ser maior que a inicial.");
      return;
    }

    const conflict = data.bookings.some((booking) => {
      if (booking.vehicleId !== values.vehicleId) return false;
      return new Date(values.start) < new Date(booking.end) && new Date(values.end) > new Date(booking.start);
    });

    if (conflict) {
      toast("Este veículo já possui agendamento nesse período.");
      return;
    }

    await createRecord("bookings", values, form, "Agendamento criado.");
  });

  bindForm("quickExitForm", async (values, form) => {
    const editId = editing[form.id];
    const conflict = quickExitConflict(values.vehicleId, editId);
    if (values.status === "Aberta" && conflict) {
      toast(conflict);
      return;
    }

    const advanceAmount = values.advanceAmount ? Number(values.advanceAmount) : 0;
    const fuelExpense = values.fuelExpense ? Number(values.fuelExpense) : 0;
    const foodExpense = values.foodExpense ? Number(values.foodExpense) : 0;
    const otherExpense = values.otherExpense ? Number(values.otherExpense) : 0;
    const spentAmount = fuelExpense + foodExpense + otherExpense;
    const returnedAmount = values.returnedAmount ? Number(values.returnedAmount) : 0;
    await createRecord("quickExits", {
      vehicleId: values.vehicleId,
      driverId: values.driverId,
      departureAt: values.departureAt,
      returnedAt: values.returnedAt || "",
      destination: values.destination,
      reason: values.reason,
      advanceAmount,
      advancePurpose: values.advancePurpose,
      fuelExpense,
      foodExpense,
      otherExpense,
      spentAmount,
      returnedAmount,
      receiptRef: values.receiptRef || "",
      notes: values.notes || "",
      status: values.status
    }, form, "Saída rápida registrada.");
  });

  bindForm("fuelForm", async (values, form) => {
    await createRecord("fuel", {
      vehicleId: values.vehicleId,
      date: values.date,
      liters: Number(values.liters),
      total: Number(values.total),
      station: values.station || ""
    }, form, "Abastecimento registrado.");
  });

  bindForm("maintenanceForm", async (values, form) => {
    await createRecord("maintenance", {
      vehicleId: values.vehicleId,
      type: values.type,
      date: values.date,
      cost: Number(values.cost),
      status: values.status,
      nextDue: values.nextDue,
      description: values.description
    }, form, "Manutenção registrada.");
  });

  bindForm("checklistForm", async (values, form) => {
    await createRecord("checklists", {
      vehicleId: values.vehicleId,
      driverId: values.driverId,
      type: values.type,
      date: values.date,
      fuelLevel: values.fuelLevel,
      tires: values.tires === "on",
      lights: values.lights === "on",
      documents: values.documents === "on",
      cleanliness: values.cleanliness === "on",
      notes: values.notes || "",
      status: values.status
    }, form, "Checklist salvo.");
  });

  bindForm("userForm", async (values, form) => {
    const payload = {
      name: values.name,
      email: values.email,
      role: values.role,
      driverId: values.driverId || ""
    };
    if (values.password) payload.password = values.password;
    await createRecord("users", payload, form, "Usuário salvo.");
  });

  bindForm("documentForm", async (values, form) => {
    await createRecord("documents", {
      ownerType: values.ownerType,
      ownerId: values.ownerId,
      type: values.type,
      dueDate: values.dueDate,
      name: values.name,
      fileRef: values.fileRef || "",
      notes: values.notes || ""
    }, form, "Documento salvo.");
  });
}

function navigateTo(view) {
  document.querySelector(`[data-view="${view}"]`)?.click();
}

function bindForm(id, handler) {
  const form = document.getElementById(id);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await handler(values, form);
    } catch (error) {
      toast(error.message);
    }
  });
}

async function createRecord(collection, payload, form, message) {
  const editId = editing[form.id];
  await api(editId ? `/api/${collection}/${editId}` : `/api/${collection}`, {
    method: editId ? "PUT" : "POST",
    body: payload
  });
  delete editing[form.id];
  await refreshData();
  form.reset();
  resetSubmitButton(form);
  setDefaultDates();
  renderAll();
  toast(editId ? "Registro atualizado." : message);
}

async function submitMobileCheckout(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  if (!values.vehicleId) {
    toast("Nenhum veículo disponível para retirada.");
    return;
  }

  try {
    await api("/api/mobile/checkout", {
      method: "POST",
      body: {
        vehicleId: values.vehicleId,
        destination: values.destination,
        reason: "Retirada pelo modo motorista"
      }
    });
    await refreshData();
    form.reset();
    renderAll();
    toast("Retirada registrada.");
  } catch (error) {
    toast(error.message);
  }
}

async function returnMobileExit(id) {
  const notes = window.prompt("Observação da devolução, se houver:", "Veículo devolvido à empresa.");
  if (notes === null) return;

  try {
    toast("Obtendo localização da devolução...");
    const location = await getReturnLocation();
    await api("/api/mobile/return", {
      method: "POST",
      body: {
        quickExitId: id,
        notes,
        returnLatitude: location?.latitude ?? "",
        returnLongitude: location?.longitude ?? "",
        returnAccuracy: location?.accuracy ?? "",
        returnLocationAt: location ? toDateTimeValue(new Date()) : ""
      }
    });
    await refreshData();
    renderAll();
    toast(location ? "Devolução registrada com localização." : "Devolução registrada sem localização.");
  } catch (error) {
    toast(error.message);
  }
}

function getReturnLocation() {
  if (!("geolocation" in navigator)) return Promise.resolve(null);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  });
}

async function removeRecord(collection, id) {
  if (currentUser?.role !== "admin") {
    toast("Apenas administradores podem remover registros.");
    return;
  }

  const record = (data[collection] || []).find((item) => item.id === id);
  const label = summarizeForDelete(collection, record);
  const confirmed = window.confirm(`Tem certeza que deseja remover ${entityLabel(collection)}${label ? `: ${label}` : ""}?`);
  if (!confirmed) return;

  try {
    data = await api(`/api/${collection}/${id}`, { method: "DELETE" });
    renderAll();
    toast("Registro removido.");
  } catch (error) {
    toast(error.message);
  }
}

function removeButton(collection, id) {
  if (currentUser?.role !== "admin") return "";
  return `<button class="danger-button" type="button" data-remove="${collection}" data-id="${id}">Remover</button>`;
}

function summarizeForDelete(collection, record) {
  if (!record) return "";
  if (collection === "vehicles") return `${record.plate} - ${record.model}`;
  if (collection === "drivers") return record.name;
  if (collection === "bookings") return record.destination;
  if (collection === "quickExits") return record.destination;
  if (collection === "fuel") return `${vehicleLabel(findVehicle(record.vehicleId))} em ${formatDate(record.date)}`;
  if (collection === "maintenance") return `${record.type} - ${vehicleLabel(findVehicle(record.vehicleId))}`;
  if (collection === "checklists") return `${record.type} - ${vehicleLabel(findVehicle(record.vehicleId))}`;
  if (collection === "documents") return record.name;
  if (collection === "users") return record.email;
  return record.id || "";
}

function editRecord(collection, id) {
  const map = {
    vehicles: "vehicleForm",
    drivers: "driverForm",
    bookings: "bookingForm",
    quickExits: "quickExitForm",
    fuel: "fuelForm",
    maintenance: "maintenanceForm",
    checklists: "checklistForm",
    documents: "documentForm",
    users: "userForm"
  };
  const viewMap = {
    vehicles: "vehicles",
    drivers: "drivers",
    bookings: "schedule",
    quickExits: "quickExits",
    fuel: "fuel",
    maintenance: "maintenance",
    checklists: "checklists",
    documents: "documents",
    users: "users"
  };
  const formId = map[collection];
  const record = (data[collection] || []).find((item) => item.id === id);
  const form = document.getElementById(formId);
  if (!record || !form) return;

  navigateTo(viewMap[collection]);
  editing[formId] = id;
  Object.entries(record).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field || key === "id" || key === "passwordHash") return;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
      return;
    }
    field.value = value ?? "";
  });
  if (collection === "documents") renderDocumentOwners();

  if (form.elements.password) form.elements.password.value = "";
  form.querySelector(".primary-button").textContent = "Salvar alterações";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Registro carregado para edição.");
}

function startQuickExitForVehicle(vehicleId) {
  const form = document.getElementById("quickExitForm");
  const conflict = quickExitConflict(vehicleId);
  if (conflict) {
    toast(conflict);
    return;
  }

  navigateTo("quickExits");
  delete editing.quickExitForm;
  form.reset();
  setDefaultDates();
  form.elements.vehicleId.value = vehicleId;
  form.elements.status.value = "Aberta";
  form.elements.advanceAmount.value = "0";
  form.elements.fuelExpense.value = "0";
  form.elements.foodExpense.value = "0";
  form.elements.otherExpense.value = "0";
  form.elements.spentAmount.value = "0";
  form.elements.returnedAmount.value = "0";
  resetSubmitButton(form);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.driverId.focus();
  toast("Veículo selecionado para nova saída rápida.");
}

function startDocumentForRequirement(ownerType, ownerId, type) {
  const form = document.getElementById("documentForm");
  navigateTo("documents");
  delete editing.documentForm;
  form.reset();
  setDefaultDates();
  form.elements.ownerType.value = ownerType;
  renderDocumentOwners();
  form.elements.ownerId.value = ownerId;
  form.elements.type.value = type;
  form.elements.name.value = `${type} - ${ownerType === "driver" ? driverLabel(findDriver(ownerId)) : vehicleLabel(findVehicle(ownerId))}`;
  resetSubmitButton(form);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.dueDate.focus();
  toast("Cadastro de documento preparado.");
}

async function completeMaintenance(id) {
  const item = (data.maintenance || []).find((record) => record.id === id);
  if (!item) return;

  const confirmed = window.confirm(`Concluir manutenção de ${vehicleLabel(findVehicle(item.vehicleId))}?`);
  if (!confirmed) return;

  try {
    await api(`/api/maintenance/${id}`, {
      method: "PUT",
      body: { ...item, status: "Concluída" }
    });
    await refreshData();
    renderAll();
    toast("Manutenção concluída. Disponibilidade recalculada.");
  } catch (error) {
    toast(error.message);
  }
}

async function closeQuickExit(id) {
  const item = (data.quickExits || []).find((record) => record.id === id);
  if (!item) return;

  closingQuickExitId = id;
  const form = document.getElementById("quickExitCloseForm");
  form.elements.fuelExpense.value = Number(item.fuelExpense || 0).toFixed(2);
  form.elements.foodExpense.value = Number(item.foodExpense || 0).toFixed(2);
  form.elements.otherExpense.value = Number(item.otherExpense || 0).toFixed(2);
  const receipts = parseSettlementReceipts(item.receiptRef || "");
  form.elements.fuelReceiptRef.value = receipts.fuel || "";
  form.elements.foodReceiptRef.value = receipts.food || "";
  form.elements.otherReceiptRef.value = receipts.other || "";
  form.elements.fuelReceiptFile.value = "";
  form.elements.foodReceiptFile.value = "";
  form.elements.otherReceiptFile.value = "";
  renderReceiptList("fuelReceiptList", receipts.fuel);
  renderReceiptList("foodReceiptList", receipts.food);
  renderReceiptList("otherReceiptList", receipts.other);
  form.elements.returnedAt.value = item.returnedAt || toDateTimeValue(new Date());
  form.elements.receiptRef.value = receipts.general || "";
  form.elements.notes.value = item.notes || "";
  document.getElementById("settlementAdvance").textContent = currency.format(item.advanceAmount || 0);
  document.getElementById("settlementContext").textContent = `${vehicleLabel(findVehicle(item.vehicleId))} · ${driverLabel(findDriver(item.driverId))} · ${item.destination}`;
  updateSettlementTotals();
  document.getElementById("quickExitCloseModal").classList.remove("is-hidden");
}

function closeSettlementModal() {
  closingQuickExitId = null;
  document.getElementById("quickExitCloseModal").classList.add("is-hidden");
  ["fuelReceiptList", "foodReceiptList", "otherReceiptList"].forEach((id) => renderReceiptList(id, ""));
}

function settlementValues() {
  const form = document.getElementById("quickExitCloseForm");
  const fuelExpense = Number(form.elements.fuelExpense.value || 0);
  const foodExpense = Number(form.elements.foodExpense.value || 0);
  const otherExpense = Number(form.elements.otherExpense.value || 0);
  const spentAmount = fuelExpense + foodExpense + otherExpense;
  const item = (data.quickExits || []).find((record) => record.id === closingQuickExitId);
  const advanceAmount = Number(item?.advanceAmount || 0);
  const returnedAmount = Math.max(advanceAmount - spentAmount, 0);

  return { fuelExpense, foodExpense, otherExpense, spentAmount, returnedAmount };
}

function updateSettlementTotals() {
  const values = settlementValues();
  document.getElementById("settlementSpent").textContent = currency.format(values.spentAmount);
  document.getElementById("settlementReturn").textContent = currency.format(values.returnedAmount);
}

function parseSettlementReceipts(value) {
  const receipts = { fuel: "", food: "", other: "", general: "" };
  const text = String(value || "").trim();
  if (!text) return receipts;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const [rawLabel, ...rest] = line.split(":");
    const content = rest.join(":").trim();
    const label = normalizeStatus(rawLabel);
    if (!content) continue;
    if (label === "combustivel") receipts.fuel = content;
    else if (label === "alimentacao") receipts.food = content;
    else if (label === "outras despesas") receipts.other = content;
    else if (label === "geral") receipts.general = content;
    else receipts.general = receipts.general ? `${receipts.general}; ${line}` : line;
  }

  if (!receipts.fuel && !receipts.food && !receipts.other && !receipts.general) {
    receipts.general = text;
  }

  return receipts;
}

function buildSettlementReceiptRef(form) {
  return [
    ["Combustível", form.elements.fuelReceiptRef.value],
    ["Alimentação", form.elements.foodReceiptRef.value],
    ["Outras despesas", form.elements.otherReceiptRef.value],
    ["Geral", form.elements.receiptRef.value]
  ]
    .map(([label, value]) => [label, String(value || "").trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function compactReceiptRef(value) {
  const receipts = parseSettlementReceipts(value);
  const labels = [];
  if (receipts.fuel) labels.push("combustível");
  if (receipts.food) labels.push("alimentação");
  if (receipts.other) labels.push("outras");
  if (receipts.general) labels.push("geral");
  return labels.length ? labels.join(", ") : String(value || "").trim();
}

async function submitQuickExitSettlement(event) {
  event.preventDefault();
  const item = (data.quickExits || []).find((record) => record.id === closingQuickExitId);
  if (!item) return;

  const form = event.currentTarget;
  const values = settlementValues();
  try {
    await api(`/api/quickExits/${item.id}`, {
      method: "PUT",
      body: {
        ...item,
        ...values,
        returnedAt: form.elements.returnedAt.value,
        receiptRef: buildSettlementReceiptRef(form),
        notes: form.elements.notes.value || item.notes || "",
        status: "Concluída"
      }
    });
    await refreshData();
    closeSettlementModal();
    renderAll();
    toast("Saída rápida finalizada.");
  } catch (error) {
    toast(error.message);
  }
}

/*
 * Mantido separado do modal para que a listagem mostre o mesmo cálculo
 * usado na conferência.
 */
function quickExitBalance(item) {
  return Number(item.advanceAmount || 0) - Number(item.spentAmount || 0) - Number(item.returnedAmount || 0);
}

async function closeQuickExitLegacy(id) {
  const item = (data.quickExits || []).find((record) => record.id === id);
  if (!item) return;

  const now = toDateTimeValue(new Date());
  const fuel = window.prompt("Quanto gastou com combustível?", String(item.fuelExpense || 0));
  if (fuel === null) return;
  const food = window.prompt("Quanto gastou com alimentação?", String(item.foodExpense || 0));
  if (food === null) return;
  const other = window.prompt("Quanto gastou com outras despesas?", String(item.otherExpense || 0));
  if (other === null) return;
  const returned = window.prompt("Valor devolvido:", String(item.returnedAmount || 0));
  if (returned === null) return;
  const fuelExpense = Number(fuel || 0);
  const foodExpense = Number(food || 0);
  const otherExpense = Number(other || 0);

  try {
    await api(`/api/quickExits/${id}`, {
      method: "PUT",
      body: {
        ...item,
        returnedAt: item.returnedAt || now,
        fuelExpense,
        foodExpense,
        otherExpense,
        spentAmount: fuelExpense + foodExpense + otherExpense,
        returnedAmount: Number(returned || 0),
        status: "Concluída"
      }
    });
    await refreshData();
    renderAll();
    toast("Saída rápida finalizada.");
  } catch (error) {
    toast(error.message);
  }
}

function resetSubmitButton(form) {
  const labels = {
    vehicleForm: "Cadastrar veículo",
    driverForm: "Cadastrar motorista",
    bookingForm: "Agendar veículo",
    quickExitForm: "Registrar saída",
    fuelForm: "Registrar abastecimento",
    maintenanceForm: "Registrar manutenção",
    checklistForm: "Salvar checklist",
    userForm: "Salvar usuário",
    documentForm: "Salvar documento"
  };
  const button = form.querySelector(".primary-button");
  if (button) button.textContent = labels[form.id] || "Salvar";
}

async function startAuthenticatedApp() {
  try {
    const session = await api("/api/me");
    currentUser = session.user;
    await refreshData();
    showApp();
    applyPermissions();
    renderAll();
    connectRealtimeEvents();
    if (currentUser?.role === "motorista") navigateTo("mobile");
    if (currentUser?.role === "admin") await refreshSystemStatus();
  } catch (error) {
    authToken = "";
    localStorage.removeItem(tokenKey);
    eventSource?.close();
    eventSource = null;
    showLogin();
    toast(error.message);
  }
}

async function refreshData() {
  data = await api("/api/data");
}

async function autoRefreshData(force = false) {
  if (!authToken || !currentUser) return;
  if (closingQuickExitId) return;
  if (Object.keys(editing).length) return;
  if (!force && Date.now() - lastAutoRefreshAt < 18000) return;

  lastAutoRefreshAt = Date.now();
  try {
    await refreshData();
    renderAll();
  } catch (error) {
    // Mantem a tela atual se a conexao oscilar.
  }
}

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authToken && !options.skipAuth) headers.Authorization = `Bearer ${authToken}`;

  const bases = [apiBase, ...apiBases].filter((base, index, list) => list.indexOf(base) === index);
  let lastError;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${url}`, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível concluir a operação.");
      }

      apiBase = base;
      localStorage.setItem("fleetdesk-api-base", base);
      return payload;
    } catch (error) {
      lastError = error;
      if (base === bases[bases.length - 1]) break;
    }
  }

  throw new Error(lastError?.message || "Não foi possível conectar ao servidor do AM3 Fleet.");
}

async function uploadReceiptFile(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;

  const form = input.closest("form");
  const target = form?.elements[input.dataset.receiptTarget];
  if (!target) return;

  try {
    const uploaded = [];
    for (const file of files) {
      uploaded.push(await uploadFile(file));
    }
    const current = splitReceiptRefs(target.value);
    target.value = [...current, ...uploaded.map((item) => item.url)].join("; ");
    const label = input.closest("label")?.textContent?.trim() || "Arquivo";
    renderReceiptList(input.dataset.receiptList, target.value);
    input.value = "";
    toast(`${label}: ${uploaded.length} arquivo(s) anexado(s).`);
  } catch (error) {
    input.value = "";
    toast(error.message);
  }
}

function splitReceiptRefs(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderReceiptList(id, value) {
  const element = document.getElementById(id);
  if (!element) return;

  const files = splitReceiptRefs(value);
  if (!files.length) {
    element.innerHTML = '<span>Nenhum arquivo anexado.</span>';
    return;
  }

  element.innerHTML = files.map((file) => `
    <a href="${escapeHtml(file)}" target="_blank" rel="noopener" data-file-url="${escapeHtml(file)}">${escapeHtml(file.split("/").pop() || file)}</a>
  `).join("");

  element.querySelectorAll("[data-file-url]").forEach((link) => {
    link.addEventListener("click", openStoredFile);
  });
}

async function openStoredFile(event) {
  const url = event.currentTarget.dataset.fileUrl || "";
  if (!url.startsWith("/api/files/")) return;

  event.preventDefault();
  try {
    const blobUrl = await fetchStoredFile(url);
    window.open(blobUrl, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  } catch (error) {
    toast(error.message);
  }
}

async function fetchStoredFile(url) {
  const bases = [apiBase, ...apiBases].filter((base, index, list) => list.indexOf(base) === index);
  let lastError;

  for (const base of bases) {
    try {
      const headers = {};
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const response = await fetch(`${base}${url}`, { headers });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Não foi possível abrir o arquivo.");
      }
      apiBase = base;
      localStorage.setItem("fleetdesk-api-base", base);
      return URL.createObjectURL(await response.blob());
    } catch (error) {
      lastError = error;
      if (base === bases[bases.length - 1]) break;
    }
  }

  throw new Error(lastError?.message || "Não foi possível abrir o arquivo.");
}

async function uploadFile(file) {
  const bases = [apiBase, ...apiBases].filter((base, index, list) => list.indexOf(base) === index);
  let lastError;
  const contentBase64 = await fileToBase64(file);

  for (const base of bases) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const response = await fetch(`${base}/api/upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível anexar o arquivo.");
      }
      apiBase = base;
      localStorage.setItem("fleetdesk-api-base", base);
      return payload;
    } catch (error) {
      lastError = error;
      if (base === bases[bases.length - 1]) break;
    }
  }

  throw new Error(lastError?.message || "Não foi possível anexar o arquivo.");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(String(reader.result || "").split(",")[1] || "");
    });
    reader.addEventListener("error", () => reject(new Error("Não foi possível ler o arquivo.")));
    reader.readAsDataURL(file);
  });
}

function showLogin() {
  document.body.classList.remove("booting");
  document.getElementById("bootScreen")?.classList.add("is-hidden");
  document.getElementById("loginScreen").classList.remove("is-hidden");
  document.getElementById("appShell").classList.add("is-hidden");
}

function showApp() {
  document.body.classList.remove("booting");
  document.getElementById("bootScreen")?.classList.add("is-hidden");
  document.getElementById("loginScreen").classList.add("is-hidden");
  document.getElementById("appShell").classList.remove("is-hidden");
}

function applyPermissions() {
  const isAdmin = currentUser?.role === "admin";
  const isDriver = currentUser?.role === "motorista";
  if (isDriver) {
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("is-hidden", item.dataset.view !== "mobile");
    });
    document.querySelector(".topbar-actions")?.classList.add("is-hidden");
    return;
  }

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("is-hidden"));
  document.querySelector(".topbar-actions")?.classList.remove("is-hidden");
  document.querySelectorAll('[data-view="users"]').forEach((item) => {
    item.classList.toggle("is-hidden", !isAdmin);
  });
  document.querySelectorAll('[data-view="audit"]').forEach((item) => {
    item.classList.toggle("is-hidden", !isAdmin);
  });
  document.querySelectorAll('[data-view="system"]').forEach((item) => {
    item.classList.toggle("is-hidden", !isAdmin);
  });

  if (!isAdmin && (document.getElementById("users").classList.contains("active-view") || document.getElementById("audit").classList.contains("active-view") || document.getElementById("system").classList.contains("active-view"))) {
    document.querySelector('[data-view="dashboard"]').click();
  }
}

function setDefaultDates() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const nextMonth = new Date(now);
  nextMonth.setMonth(now.getMonth() + 3);

  document.querySelectorAll('input[type="date"]').forEach((input) => {
    if (!input.value) input.value = toDateValue(now);
  });
  document.querySelectorAll('input[name="nextDue"]').forEach((input) => {
    input.value = toDateValue(nextMonth);
  });
  document.querySelectorAll('input[name="start"]').forEach((input) => {
    if (!input.value) input.value = toDateTimeValue(now);
  });
  document.querySelectorAll('input[name="departureAt"]').forEach((input) => {
    if (!input.value) input.value = toDateTimeValue(now);
  });
  document.querySelectorAll('input[name="end"]').forEach((input) => {
    if (!input.value) input.value = toDateTimeValue(tomorrow);
  });
  document.querySelectorAll('input[name="date"][type="datetime-local"]').forEach((input) => {
    if (!input.value) input.value = toDateTimeValue(now);
  });
}

function toDateValue(date) {
  return date.toISOString().slice(0, 10);
}

function toDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function renderAll() {
  renderSelects();
  renderDocumentOwners();
  renderMetrics();
  renderDashboard();
  renderReception();
  renderVehicles();
  renderDrivers();
  renderBookings();
  renderQuickExits();
  renderFuel();
  renderMaintenance();
  renderRelease();
  renderChecklists();
  renderDocuments();
  renderExpirations();
  renderMobileDriver();
  renderUsers();
  renderAudit();
  renderSystem();
  renderReports();
}

function renderSelects() {
  document.querySelectorAll('select[name="vehicleId"]').forEach((select) => {
    select.innerHTML = data.vehicles.map((vehicle) => `<option value="${vehicle.id}">${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.model)}</option>`).join("");
  });

  document.querySelectorAll('select[name="driverId"]').forEach((select) => {
    select.innerHTML = data.drivers.map((driver) => `<option value="${driver.id}">${escapeHtml(driver.name)}</option>`).join("");
  });
  document.querySelectorAll('#userForm select[name="driverId"]').forEach((select) => {
    select.innerHTML = '<option value="">Sem vínculo</option>' + data.drivers.map((driver) => `<option value="${driver.id}">${escapeHtml(driver.name)}</option>`).join("");
  });
  renderMobileVehicleSelect();
  renderReportFilters();
}

function renderReportFilters() {
  const vehicle = document.getElementById("reportVehicle");
  const driver = document.getElementById("reportDriver");
  if (!vehicle || !driver) return;

  const currentVehicle = vehicle.value;
  const currentDriver = driver.value;
  vehicle.innerHTML = '<option value="">Todos</option>' + data.vehicles.map((item) => `<option value="${item.id}">${escapeHtml(item.plate)} - ${escapeHtml(item.model)}</option>`).join("");
  driver.innerHTML = '<option value="">Todos</option>' + data.drivers.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  vehicle.value = currentVehicle;
  driver.value = currentDriver;

  const start = document.getElementById("reportStart");
  const end = document.getElementById("reportEnd");
  if (start && !start.value) start.value = firstDayOfCurrentMonth();
  if (end && !end.value) end.value = toDateValue(new Date());
}

function renderDocumentOwners() {
  const form = document.getElementById("documentForm");
  if (!form) return;
  const ownerType = form.elements.ownerType.value;
  const rows = ownerType === "driver" ? data.drivers : data.vehicles;
  form.elements.ownerId.innerHTML = rows.map((item) => {
    const label = ownerType === "driver" ? item.name : `${item.plate} - ${item.model}`;
    return `<option value="${item.id}">${escapeHtml(label)}</option>`;
  }).join("");
}

function renderMetrics() {
  const currentMonthFilters = {
    start: firstDayOfCurrentMonth(),
    end: toDateValue(new Date()),
    vehicleId: "",
    driverId: ""
  };
  const totalFuel = data.fuel
    .filter((item) => isInReportPeriod(item.date, currentMonthFilters))
    .reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalMaintenance = data.maintenance
    .filter((item) => isInReportPeriod(item.date, currentMonthFilters))
    .reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const totalQuickExitExpenses = (data.quickExits || [])
    .filter((item) => isCompletedStatus(item.status) && (isInReportPeriod(item.returnedAt, currentMonthFilters) || isInReportPeriod(item.departureAt, currentMonthFilters)))
    .reduce((sum, item) => sum + Number(item.spentAmount || 0), 0);
  const available = data.vehicles.filter((vehicle) => computedVehicleStatus(vehicle).status === "Disponível").length;
  const openMaintenance = data.maintenance.filter((item) => item.status !== "Concluída").length;
  const dueDocuments = (data.documents || []).filter((item) => documentStatus(item).days <= 30).length;
  const missingDocuments = requiredDocumentGaps().length;
  const currentBookings = data.bookings.filter((booking) => isNowBetween(booking.start, booking.end)).length;
  const openQuickExits = (data.quickExits || []).filter((item) => item.status === "Aberta").length;

  const cards = [
    { label: "Veículos", value: data.vehicles.length, hint: `${available} disponíveis` },
    { label: "Motoristas ativos", value: data.drivers.filter((driver) => driver.status === "Ativo").length, hint: `${data.drivers.length} cadastrados` },
    { label: "Custo no mês", value: currency.format(totalFuel + totalMaintenance + totalQuickExitExpenses), hint: "Abastecimento + manutenção + saídas", className: "metric-card-wide metric-card-center" },
    { label: "Em uso agora", value: currentBookings + openQuickExits, hint: "Agenda + saídas rápidas" },
    { label: "Manutenções", value: openMaintenance, hint: "Pendências abertas" },
    { label: "Documentos", value: dueDocuments + missingDocuments, hint: "Vencidos, próximos ou faltando" }
  ];

  document.getElementById("metricsGrid").innerHTML = cards.map((card) => `
    <article class="metric-card ${card.className || ""}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.hint)}</small>
    </article>
  `).join("");
}

function renderDashboard() {
  const today = toDateValue(new Date());
  const todayBookings = data.bookings
    .filter((booking) => booking.start.slice(0, 10) === today)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  renderList("todaySchedule", todayBookings, (booking) => {
    const vehicle = findVehicle(booking.vehicleId);
    const driver = findDriver(booking.driverId);
    return `
      <article class="timeline-item">
        <div>
          <h3>${escapeHtml(vehicleLabel(vehicle))} · ${escapeHtml(driverLabel(driver))}</h3>
          <p>${formatDateTime(booking.start)} até ${formatDateTime(booking.end)} · ${escapeHtml(booking.destination)}</p>
        </div>
        <span class="status ok">Agendado</span>
      </article>
    `;
  });

  renderList("alertsList", buildAlerts(), (alert) => `
    <article class="alert-item">
      <div>
        <h3>${escapeHtml(alert.title)}</h3>
        <p>${escapeHtml(alert.detail)}</p>
      </div>
      <span class="status ${alert.tone}">${escapeHtml(alert.label)}</span>
    </article>
  `);

  renderList("fleetStatusList", data.vehicles, (vehicle) => {
    const computed = computedVehicleStatus(vehicle);
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.model)}</h3>
          <p>${escapeHtml(computed.reason)} · ${escapeHtml(vehicle.costCenter)}</p>
        </div>
        <span class="status ${statusTone(computed.status)}">${escapeHtml(computed.status)}</span>
      </article>
    `;
  });
}

function renderReception() {
  const openExits = (data.quickExits || [])
    .filter((item) => item.status === "Aberta")
    .sort((a, b) => new Date(a.departureAt) - new Date(b.departureAt));
  const availableVehicles = data.vehicles.filter((vehicle) => computedVehicleStatus(vehicle).status === "Disponível");
  const pendingReturn = openExits.reduce((sum, item) => sum + Math.max(Number(item.advanceAmount || 0) - Number(item.spentAmount || 0), 0), 0);
  const openAdvance = openExits.reduce((sum, item) => sum + Number(item.advanceAmount || 0), 0);

  const metrics = [
    ["Saídas abertas", openExits.length, "Aguardando retorno"],
    ["Veículos livres", availableVehicles.length, "Prontos para retirada"],
    ["Adiantado em aberto", currency.format(openAdvance), "Valores com motoristas"],
    ["Previsão de devolução", currency.format(pendingReturn), "Antes da conferência"]
  ];

  document.getElementById("receptionMetrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");

  renderList("receptionOpenExits", openExits, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    const driver = findDriver(item.driverId);
    const expectedReturn = Math.max(Number(item.advanceAmount || 0) - Number(item.spentAmount || 0), 0);
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(item.destination)}</h3>
          <p>${escapeHtml(vehicleLabel(vehicle))} · ${escapeHtml(driverLabel(driver))} · saiu ${formatDateTime(item.departureAt)} · adiantado ${currency.format(item.advanceAmount || 0)} · devolução prevista ${currency.format(expectedReturn)}</p>
        </div>
        <div class="record-actions">
          <span class="status warn">Aberta</span>
          <button class="secondary-button" type="button" data-close-exit="${item.id}">Finalizar</button>
          <button class="secondary-button" type="button" data-edit="quickExits" data-id="${item.id}">Editar</button>
        </div>
      </article>
    `;
  });

  renderList("receptionAvailableVehicles", availableVehicles, (vehicle) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.model)}</h3>
        <p>${escapeHtml(vehicle.costCenter)} · sem pendências agora</p>
      </div>
      <div class="record-actions">
        <span class="status ok">Disponível</span>
        <button class="secondary-button" type="button" data-start-quick-exit="${vehicle.id}">Nova saída</button>
      </div>
    </article>
  `);
}

function renderVehicles() {
  const vehicles = filterRows(data.vehicles, (vehicle) => [vehicle.plate, vehicle.model, vehicle.status, vehicle.costCenter].join(" "));
  renderList("vehicleList", vehicles, (vehicle) => {
    const computed = computedVehicleStatus(vehicle);
    const statusDetail = computed.reason && computed.reason !== "Sem pendências" ? ` · ${escapeHtml(computed.reason)}` : "";
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.model)}</h3>
          <p>${vehicle.year} · ${escapeHtml(vehicle.costCenter)}${statusDetail}</p>
        </div>
        <div class="record-actions">
          <span class="status ${statusTone(computed.status)}">${escapeHtml(computed.status)}</span>
          <button class="secondary-button" type="button" data-edit="vehicles" data-id="${vehicle.id}">Editar</button>
          ${removeButton("vehicles", vehicle.id)}
        </div>
      </article>
    `;
  });
}

function renderDrivers() {
  const drivers = filterRows(data.drivers, (driver) => [driver.name, driver.phone, driver.license, driver.status, driver.department].join(" "));
  renderList("driverList", drivers, (driver) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(driver.name)}</h3>
        <p>${escapeHtml(driver.phone)} · CNH ${escapeHtml(driver.license)} · vence em ${formatDate(driver.licenseDue)} · ${escapeHtml(driver.department)}</p>
      </div>
      <div class="record-actions">
        <span class="status ${statusTone(driver.status)}">${escapeHtml(driver.status)}</span>
        <button class="secondary-button" type="button" data-edit="drivers" data-id="${driver.id}">Editar</button>
        ${removeButton("drivers", driver.id)}
      </div>
    </article>
  `);
}

function renderBookings() {
  const bookings = filterRows(data.bookings, (booking) => {
    const vehicle = findVehicle(booking.vehicleId);
    const driver = findDriver(booking.driverId);
    return [vehicleLabel(vehicle), driverLabel(driver), booking.destination, booking.purpose].join(" ");
  }).sort((a, b) => new Date(a.start) - new Date(b.start));

  renderList("bookingList", bookings, (booking) => {
    const vehicle = findVehicle(booking.vehicleId);
    const driver = findDriver(booking.driverId);
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(booking.destination)}</h3>
          <p>${escapeHtml(vehicleLabel(vehicle))} · ${escapeHtml(driverLabel(driver))} · ${formatDateTime(booking.start)} até ${formatDateTime(booking.end)} · ${escapeHtml(booking.purpose)}</p>
        </div>
        <div class="record-actions">
          <span class="status ok">Reservado</span>
          <button class="secondary-button" type="button" data-edit="bookings" data-id="${booking.id}">Editar</button>
          ${removeButton("bookings", booking.id)}
        </div>
      </article>
    `;
  });
}

function quickExitLocationLink(item) {
  const latitude = Number(item.returnLatitude);
  const longitude = Number(item.returnLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";

  const accuracy = Number(item.returnAccuracy);
  const label = Number.isFinite(accuracy) && accuracy > 0 ? `localização ±${Math.round(accuracy)}m` : "localização";
  const query = encodeURIComponent(`${latitude},${longitude}`);
  return ` · <a href="https://www.google.com/maps?q=${query}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function renderQuickExits() {
  const exits = filterRows(data.quickExits || [], (item) => {
    const vehicle = findVehicle(item.vehicleId);
    const driver = findDriver(item.driverId);
    return [vehicleLabel(vehicle), driverLabel(driver), item.destination, item.reason, item.advancePurpose, item.status].join(" ");
  }).sort((a, b) => new Date(b.departureAt) - new Date(a.departureAt));

  renderList("quickExitList", exits, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    const driver = findDriver(item.driverId);
    const returned = item.returnedAt ? ` · retorno ${formatDateTime(item.returnedAt)}` : "";
    const receipts = item.receiptRef ? ` · comprovantes ${escapeHtml(compactReceiptRef(item.receiptRef))}` : "";
    const location = quickExitLocationLink(item);
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(item.destination)}</h3>
          <p>${escapeHtml(vehicleLabel(vehicle))} · ${escapeHtml(driverLabel(driver))} · saída ${formatDateTime(item.departureAt)}${returned} · ${escapeHtml(item.reason)} · adiantado ${currency.format(item.advanceAmount || 0)} · combustível ${currency.format(item.fuelExpense || 0)} · alimentação ${currency.format(item.foodExpense || 0)} · outras ${currency.format(item.otherExpense || 0)} · devolvido ${currency.format(item.returnedAmount || 0)} · saldo ${currency.format(quickExitBalance(item))}${receipts}${location}</p>
        </div>
        <div class="record-actions">
          <span class="status ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
          ${["aberta", "aguardando conferencia"].includes(normalizeStatus(item.status)) ? `<button class="secondary-button" type="button" data-close-exit="${item.id}">Finalizar</button>` : ""}
          <button class="secondary-button" type="button" data-edit="quickExits" data-id="${item.id}">Editar</button>
          ${removeButton("quickExits", item.id)}
        </div>
      </article>
    `;
  });
}

function renderFuel() {
  const fuel = filterRows(data.fuel, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    return [vehicleLabel(vehicle), item.station, item.total].join(" ");
  });

  renderList("fuelList", fuel, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    const price = Number(item.total) / Number(item.liters);
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(vehicleLabel(vehicle))} · ${formatDate(item.date)}</h3>
          <p>${Number(item.liters).toLocaleString("pt-BR")} L · ${currency.format(item.total)} · ${currency.format(price)}/L · ${escapeHtml(item.station || "posto não informado")}</p>
        </div>
        <div class="record-actions">
          <button class="secondary-button" type="button" data-edit="fuel" data-id="${item.id}">Editar</button>
          ${removeButton("fuel", item.id)}
        </div>
      </article>
    `;
  });
}

function renderMaintenance() {
  const maintenance = filterRows(data.maintenance, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    return [vehicleLabel(vehicle), item.type, item.description, item.status].join(" ");
  });

  renderList("maintenanceList", maintenance, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(vehicleLabel(vehicle))} · ${escapeHtml(item.type)}</h3>
          <p>${formatDate(item.date)} · ${currency.format(item.cost)} · próxima em ${formatDate(item.nextDue)} · ${escapeHtml(item.description)}</p>
        </div>
        <div class="record-actions">
          <span class="status ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
          <button class="secondary-button" type="button" data-edit="maintenance" data-id="${item.id}">Editar</button>
          ${removeButton("maintenance", item.id)}
        </div>
      </article>
    `;
  });
}

function renderRelease() {
  const openMaintenance = (data.maintenance || [])
    .filter((item) => item.status !== "Concluída")
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const blockedVehicleIds = new Set(openMaintenance.map((item) => item.vehicleId));
  const blockedVehicles = data.vehicles.filter((vehicle) => blockedVehicleIds.has(vehicle.id));
  const scheduled = openMaintenance.filter((item) => item.status === "Agendada").length;
  const totalCost = openMaintenance.reduce((sum, item) => sum + Number(item.cost || 0), 0);

  const metrics = [
    ["Veículos bloqueados", blockedVehicles.length, "Indisponíveis para retirada"],
    ["Manutenções abertas", openMaintenance.length, "Pendências de oficina"],
    ["Agendadas", scheduled, "Aguardando execução"],
    ["Custo previsto", currency.format(totalCost), "Pendências abertas"]
  ];

  document.getElementById("releaseMetrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");

  renderList("releaseBlockedVehicles", blockedVehicles, (vehicle) => {
    const items = openMaintenance.filter((item) => item.vehicleId === vehicle.id);
    const summary = items.map((item) => `${item.type} em ${formatDate(item.date)}`).join(" · ");
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.model)}</h3>
          <p>${escapeHtml(summary)} · ${escapeHtml(vehicle.costCenter)}</p>
        </div>
        <div class="record-actions">
          <span class="status danger">Manutenção</span>
          <button class="secondary-button" type="button" data-go-maintenance="${items[0]?.id || ""}">Ver pendência</button>
        </div>
      </article>
    `;
  });

  renderList("releaseOpenMaintenance", openMaintenance, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(vehicleLabel(vehicle))} · ${escapeHtml(item.type)}</h3>
          <p>${formatDate(item.date)} · ${currency.format(item.cost || 0)} · ${escapeHtml(item.description)} · próxima revisão ${formatDate(item.nextDue)}</p>
        </div>
        <div class="record-actions">
          <span class="status ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
          <button class="primary-button" type="button" data-complete-maintenance="${item.id}">Concluir</button>
          <button class="secondary-button" type="button" data-edit="maintenance" data-id="${item.id}">Editar</button>
        </div>
      </article>
    `;
  });
}

function renderChecklists() {
  const checklists = filterRows(data.checklists || [], (item) => {
    const vehicle = findVehicle(item.vehicleId);
    const driver = findDriver(item.driverId);
    return [vehicleLabel(vehicle), driverLabel(driver), item.type, item.status, item.notes].join(" ");
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  renderList("checklistList", checklists, (item) => {
    const vehicle = findVehicle(item.vehicleId);
    const driver = findDriver(item.driverId);
    const checks = [
      item.tires ? "pneus" : "pneus pendente",
      item.lights ? "luzes" : "luzes pendente",
      item.documents ? "documentos" : "documentos pendente",
      item.cleanliness ? "limpeza" : "limpeza pendente"
    ].join(" · ");
    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(item.type)} · ${escapeHtml(vehicleLabel(vehicle))}</h3>
          <p>${formatDateTime(item.date)} · ${escapeHtml(driverLabel(driver))} · combustível ${escapeHtml(item.fuelLevel)} · ${escapeHtml(checks)} · ${escapeHtml(item.notes || "sem observações")}</p>
        </div>
        <div class="record-actions">
          <span class="status ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
          <button class="secondary-button" type="button" data-edit="checklists" data-id="${item.id}">Editar</button>
          ${removeButton("checklists", item.id)}
        </div>
      </article>
    `;
  });
}

function renderDocuments() {
  const documents = filterRows(data.documents || [], (item) => {
    return [item.type, item.name, documentOwnerLabel(item), item.fileRef, item.notes].join(" ");
  }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  renderList("documentList", documents, (item) => {
    const status = documentStatus(item);

    return `
      <article class="record">
        <div>
          <h3>${escapeHtml(item.type)} · ${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(documentOwnerLabel(item))} · vence em ${formatDate(item.dueDate)} · ${escapeHtml(item.fileRef || "sem arquivo informado")} · ${escapeHtml(item.notes || "sem observações")}</p>
        </div>
        <div class="record-actions">
          <span class="status ${status.tone}">${status.label}</span>
          <button class="secondary-button" type="button" data-edit="documents" data-id="${item.id}">Editar</button>
          ${removeButton("documents", item.id)}
        </div>
      </article>
    `;
  });
}

function renderExpirations() {
  const watchedDocuments = (data.documents || [])
    .map((item) => ({ ...item, statusInfo: documentStatus(item) }))
    .filter((item) => item.statusInfo.days <= 30)
    .sort((a, b) => a.statusInfo.days - b.statusInfo.days);
  const missing = requiredDocumentGaps();
  const expired = watchedDocuments.filter((item) => item.statusInfo.days < 0).length;
  const dueSoon = watchedDocuments.filter((item) => item.statusInfo.days >= 0).length;

  const metrics = [
    ["Vencidos", expired, "Exigem regularização"],
    ["Próximos", dueSoon, "Vencem em até 30 dias"],
    ["Faltando", missing.length, "Obrigatórios sem cadastro válido"],
    ["Monitorados", (data.documents || []).length, "Documentos cadastrados"]
  ];

  document.getElementById("expirationMetrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");

  renderList("expirationDueList", watchedDocuments, (item) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(item.type)} · ${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(documentOwnerLabel(item))} · vence em ${formatDate(item.dueDate)} · ${escapeHtml(item.statusInfo.detail)}</p>
      </div>
      <div class="record-actions">
        <span class="status ${item.statusInfo.tone}">${escapeHtml(item.statusInfo.label)}</span>
        <button class="secondary-button" type="button" data-edit="documents" data-id="${item.id}">Editar</button>
      </div>
    </article>
  `);

  renderList("expirationMissingList", missing, (item) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(item.type)} · ${escapeHtml(item.ownerLabel)}</h3>
        <p>${escapeHtml(item.reason)}</p>
      </div>
      <div class="record-actions">
        <span class="status danger">Faltando</span>
        <button class="secondary-button" type="button" data-start-document="${item.ownerType}" data-owner-id="${item.ownerId}" data-document-type="${item.type}">Cadastrar</button>
      </div>
    </article>
  `);
}

function renderUsers() {
  if (currentUser?.role !== "admin") {
    document.getElementById("userList").innerHTML = '<div class="empty-state">Acesso restrito a administradores.</div>';
    return;
  }

  renderList("userList", data.users || [], (user) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(user.name)}</h3>
        <p>${escapeHtml(user.email)} · ${escapeHtml(user.role)}${user.driverId ? ` · ${escapeHtml(driverLabel(findDriver(user.driverId)))}` : ""}</p>
      </div>
      <div class="record-actions">
        <span class="status ${user.role === "admin" ? "ok" : user.role === "motorista" ? "warn" : ""}">${user.role === "admin" ? "Administrador" : user.role === "motorista" ? "Motorista" : "Operador"}</span>
        <button class="secondary-button" type="button" data-edit="users" data-id="${user.id}">Editar</button>
        ${removeButton("users", user.id)}
      </div>
    </article>
  `);
}

function renderMobileVehicleSelect() {
  const select = document.querySelector('#mobileCheckoutForm select[name="vehicleId"]');
  if (!select) return;

  const available = data.vehicles.filter((vehicle) => {
    const computed = computedVehicleStatus(vehicle);
    return computed.status === "Disponível" || computed.status === "Agendada";
  });

  select.innerHTML = available.length
    ? available.map((vehicle) => `<option value="${vehicle.id}">${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.model)}</option>`).join("")
    : '<option value="">Nenhum veículo disponível</option>';
}

function renderMobileDriver() {
  const context = document.getElementById("mobileDriverContext");
  const status = document.getElementById("mobileDriverStatus");
  const openList = document.getElementById("mobileOpenExit");
  const busyList = document.getElementById("mobileBusyVehicles");
  const form = document.getElementById("mobileCheckoutForm");
  if (!context || !status || !openList || !busyList || !form) return;

  const driver = currentDriver();
  if (!driver) {
    status.textContent = "Sem vínculo";
    status.className = "status danger";
    context.innerHTML = `
      <div class="mobile-message">
        <strong>Usuário sem motorista vinculado</strong>
        <p>Peça para a recepção editar seu usuário e selecionar o motorista correspondente.</p>
      </div>
    `;
    form.classList.add("is-hidden");
    openList.innerHTML = '<div class="empty-state">Nenhuma saída vinculada.</div>';
    busyList.innerHTML = '<div class="empty-state">Sem consulta disponível.</div>';
    return;
  }

  form.classList.remove("is-hidden");
  const ownOpenExit = (data.quickExits || []).find((item) => item.driverId === driver.id && normalizeStatus(item.status) === "aberta");
  status.textContent = ownOpenExit ? "Em uso" : "Livre";
  status.className = `status ${ownOpenExit ? "warn" : "ok"}`;
  context.innerHTML = `
    <div class="mobile-message">
      <strong>Olá, ${escapeHtml(driver.name)}</strong>
      <p>${ownOpenExit ? "Você tem uma saída aberta. Marque a devolução quando o veículo voltar à empresa." : "Nenhum veículo em aberto para você agora."}</p>
    </div>
  `;

  if (ownOpenExit) {
    const vehicle = findVehicle(ownOpenExit.vehicleId);
    openList.innerHTML = `
      <article class="record mobile-record">
        <div>
          <h3>${escapeHtml(vehicleLabel(vehicle))}</h3>
          <p>Retirado em ${formatDateTime(ownOpenExit.departureAt)} · ${escapeHtml(ownOpenExit.destination || "")}</p>
        </div>
        <div class="record-actions">
          <span class="status warn">Aberta</span>
          <button class="primary-button" type="button" data-mobile-return="${ownOpenExit.id}">Marcar devolução</button>
        </div>
      </article>
    `;
    openList.querySelector("[data-mobile-return]")?.addEventListener("click", (event) => returnMobileExit(event.currentTarget.dataset.mobileReturn));
  } else {
    openList.innerHTML = '<div class="empty-state">Você não possui saída aberta.</div>';
  }

  const busy = (data.quickExits || []).filter((item) => normalizeStatus(item.status) === "aberta");
  renderList("mobileBusyVehicles", busy, (item) => {
    const driverItem = findDriver(item.driverId);
    return `
      <article class="record mobile-record">
        <div>
          <h3>${escapeHtml(vehicleLabel(findVehicle(item.vehicleId)))}</h3>
          <p>Motorista: ${escapeHtml(driverLabel(driverItem))} · Retirado: ${formatDateTime(item.departureAt)} · Destino: ${escapeHtml(item.destination || "")}${driverItem?.phone ? ` · Tel: ${escapeHtml(driverItem.phone)}` : ""}</p>
        </div>
        <div class="record-actions">
          <span class="status warn">Em uso</span>
        </div>
      </article>
    `;
  });
}

function currentDriver() {
  if (currentUser?.driverId) {
    const linked = findDriver(currentUser.driverId);
    if (linked) return linked;
  }

  const userName = normalizeText(currentUser?.name);
  return data.drivers.find((driver) => normalizeText(driver.name) === userName) || null;
}

function renderAudit() {
  const list = document.getElementById("auditList");
  if (!list) return;
  if (currentUser?.role !== "admin") {
    list.innerHTML = '<div class="empty-state">Acesso restrito a administradores.</div>';
    return;
  }

  const rows = (data.auditLogs || []).slice(0, 80);
  renderList("auditList", rows, (item) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(item.userEmail || "sistema")} · ${escapeHtml(item.action)} ${escapeHtml(entityLabel(item.entity))}</h3>
        <p>${formatDateTime(item.createdAt)} · ${escapeHtml(item.summary || item.recordId || "sem detalhe")}</p>
      </div>
      <span class="status">${escapeHtml(item.entity)}</span>
    </article>
  `);
}

function renderSystem() {
  const metrics = document.getElementById("systemMetrics");
  const statusList = document.getElementById("systemStatusList");
  const backupList = document.getElementById("backupStatusList");
  if (!metrics || !statusList || !backupList) return;

  if (currentUser?.role !== "admin") {
    metrics.innerHTML = "";
    statusList.innerHTML = '<div class="empty-state">Acesso restrito a administradores.</div>';
    backupList.innerHTML = '<div class="empty-state">Acesso restrito a administradores.</div>';
    return;
  }

  if (!systemStatus) {
    metrics.innerHTML = "";
    statusList.innerHTML = '<div class="empty-state">Carregando status do sistema.</div>';
    backupList.innerHTML = '<div class="empty-state">Carregando informações de backup.</div>';
    return;
  }

  const db = systemStatus.database || {};
  const backup = systemStatus.backup?.last;
  const cards = [
    ["Aplicação", systemStatus.app?.version || "-", `porta ${systemStatus.app?.port || "-"}`],
    ["Banco", db.type || "-", db.mode || db.path || db.database || "-"],
    ["Registros", db.records ?? "-", "contagem do armazenamento"],
    ["Último backup", backup ? formatDateTime(backup.createdAt) : "Nenhum", backup ? formatBytes(backup.size) : "gere o primeiro backup"]
  ];

  metrics.innerHTML = cards.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </article>
  `).join("");

  const statusRows = [
    ["Servidor", `${systemStatus.app?.host || "-"}:${systemStatus.app?.port || "-"}`, `iniciado em ${formatDateTime(systemStatus.app?.startedAt)}`],
    ["Banco de dados", db.type === "sqlserver" ? `${db.server}/${db.database}` : db.path, db.mode ? `modo ${db.mode}` : "modo local"],
    ["Horário do servidor", formatDateTime(systemStatus.serverTime), "referência para auditoria e backup"]
  ];

  renderList("systemStatusList", statusRows, ([title, detail, hint]) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(detail || "-")} · ${escapeHtml(hint || "")}</p>
      </div>
      <span class="status ok">OK</span>
    </article>
  `);

  const backupRows = backup
    ? [[backup.fileName, backup.path, `${formatBytes(backup.size)} · ${formatDateTime(backup.createdAt)}`]]
    : [];

  renderList("backupStatusList", backupRows, ([title, detail, hint]) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(detail)} · ${escapeHtml(hint)}</p>
      </div>
      <span class="status ok">Pronto</span>
    </article>
  `);
}

async function refreshSystemStatus() {
  if (currentUser?.role !== "admin") return;

  try {
    systemStatus = await api("/api/system/status");
    renderSystem();
  } catch (error) {
    toast(error.message);
  }
}

async function runBackup() {
  if (currentUser?.role !== "admin") {
    toast("Apenas administradores podem gerar backup.");
    return;
  }

  const confirmed = window.confirm("Gerar backup manual completo dos dados atuais?");
  if (!confirmed) return;

  const button = document.getElementById("runBackup");
  if (button) button.disabled = true;
  try {
    const backup = await api("/api/system/backup", { method: "POST" });
    toast(`Backup gerado: ${backup.fileName}`);
    await refreshSystemStatus();
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderReports() {
  const filters = reportFilters();
  const rows = reportData(filters);
  const totalFuel = rows.finance.filter((item) => item.type === "Abastecimento").reduce((sum, item) => sum + item.value, 0);
  const totalMaintenance = rows.finance.filter((item) => item.type === "Manutenção").reduce((sum, item) => sum + item.value, 0);
  const totalAdvance = rows.finance.filter((item) => item.type === "Adiantamento").reduce((sum, item) => sum + item.value, 0);
  const totalSpent = rows.quickExits.reduce((sum, item) => sum + Number(item.spentAmount || 0), 0);
  const totalReturned = rows.quickExits.reduce((sum, item) => sum + Number(item.returnedAmount || 0), 0);
  const totalCost = totalFuel + totalMaintenance + totalSpent;
  const completedQuickExits = rows.quickExits.filter((item) => isCompletedStatus(item.status)).length;
  const openQuickExits = rows.quickExits.filter((item) => normalizeStatus(item.status) === "aberta").length;

  const metrics = [
    ["Operações", rows.operations.length, "Agenda + saídas rápidas"],
    ["Saídas rápidas", rows.quickExits.length, `${currency.format(totalAdvance)} adiantado`],
    ["Concluídas", completedQuickExits, "Saídas rápidas finalizadas"],
    ["Abertas", openQuickExits, "Aguardando retorno"],
    ["Custo total", currency.format(totalCost), "Combustível + manutenção + despesas"],
    ["Prestação de contas", currency.format(totalReturned), "Valor devolvido no período"]
  ];

  document.getElementById("reportMetrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");

  const costs = data.vehicles.map((vehicle) => {
    if (filters.vehicleId && filters.vehicleId !== vehicle.id) return null;
    const fuel = rows.fuel.filter((item) => item.vehicleId === vehicle.id).reduce((sum, item) => sum + Number(item.total), 0);
    const maintenance = rows.maintenance.filter((item) => item.vehicleId === vehicle.id).reduce((sum, item) => sum + Number(item.cost), 0);
    const quickSpent = rows.quickExits.filter((item) => item.vehicleId === vehicle.id).reduce((sum, item) => sum + Number(item.spentAmount || 0), 0);
    return { label: vehicle.plate, value: fuel + maintenance + quickSpent, detail: `${currency.format(fuel + maintenance + quickSpent)} · comb. ${currency.format(fuel)} · manut. ${currency.format(maintenance)} · saídas ${currency.format(quickSpent)}` };
  }).filter(Boolean);

  const trips = data.drivers.map((driver) => {
    if (filters.driverId && filters.driverId !== driver.id) return null;
    const scheduled = rows.bookings.filter((booking) => booking.driverId === driver.id).length;
    const quick = rows.quickExits.filter((item) => item.driverId === driver.id).length;
    return { label: driver.name, value: scheduled + quick, detail: `${scheduled} agenda · ${quick} rápida(s)` };
  }).filter(Boolean);

  renderBars("costReport", costs);
  renderBars("driverReport", trips);
  renderReportLists(rows);
}

function reportData(filters) {
  const bookings = data.bookings.filter((item) => {
    if (filters.vehicleId && filters.vehicleId !== item.vehicleId) return false;
    if (filters.driverId && filters.driverId !== item.driverId) return false;
    return isInReportPeriod(item.start, filters);
  });
  const quickExits = (data.quickExits || []).filter((item) => {
    if (filters.vehicleId && filters.vehicleId !== item.vehicleId) return false;
    if (filters.driverId && filters.driverId !== item.driverId) return false;
    return isInReportPeriod(item.departureAt, filters) || isInReportPeriod(item.returnedAt, filters);
  });
  const fuel = data.fuel.filter((item) => {
    if (filters.vehicleId && filters.vehicleId !== item.vehicleId) return false;
    return isInReportPeriod(item.date, filters);
  });
  const maintenance = data.maintenance.filter((item) => {
    if (filters.vehicleId && filters.vehicleId !== item.vehicleId) return false;
    return isInReportPeriod(item.date, filters);
  });

  const operations = [
    ...bookings.map((item) => ({
      date: item.start,
      type: "Agendamento",
      title: item.destination,
      detail: `${vehicleLabel(findVehicle(item.vehicleId))} · ${driverLabel(findDriver(item.driverId))} · ${item.purpose}`,
      status: "Reservado"
    })),
    ...quickExits.map((item) => ({
      date: item.departureAt,
      type: "Saída rápida",
      title: item.destination,
      detail: `${vehicleLabel(findVehicle(item.vehicleId))} · ${driverLabel(findDriver(item.driverId))} · ${item.reason}`,
      status: item.status
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const finance = [
    ...fuel.map((item) => ({
      date: item.date,
      type: "Abastecimento",
      title: vehicleLabel(findVehicle(item.vehicleId)),
      detail: `${Number(item.liters).toLocaleString("pt-BR")} L · ${item.station || "posto não informado"}`,
      value: Number(item.total || 0)
    })),
    ...maintenance.map((item) => ({
      date: item.date,
      type: "Manutenção",
      title: vehicleLabel(findVehicle(item.vehicleId)),
      detail: `${item.type} · ${item.description}`,
      value: Number(item.cost || 0)
    })),
    ...quickExits.map((item) => ({
      date: item.departureAt,
      type: "Adiantamento",
      title: `${vehicleLabel(findVehicle(item.vehicleId))} · ${driverLabel(findDriver(item.driverId))}`,
      detail: `${item.destination} · gasto ${currency.format(item.spentAmount || 0)} · devolvido ${currency.format(item.returnedAmount || 0)}`,
      value: Number(item.advanceAmount || 0)
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return { bookings, quickExits, fuel, maintenance, operations, finance };
}

function renderReportLists(rows) {
  renderList("operationReportList", rows.operations, (item) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(item.type)} · ${escapeHtml(item.title)}</h3>
        <p>${formatDateTime(item.date)} · ${escapeHtml(item.detail)}</p>
      </div>
      <span class="status ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
    </article>
  `);

  renderList("financeReportList", rows.finance, (item) => `
    <article class="record">
      <div>
        <h3>${escapeHtml(item.type)} · ${escapeHtml(item.title)}</h3>
        <p>${formatDate(String(item.date).slice(0, 10))} · ${escapeHtml(item.detail)}</p>
      </div>
      <strong>${currency.format(item.value)}</strong>
    </article>
  `);
}

function printReport(kind) {
  const filters = reportFilters();
  const rows = reportData(filters);
  const isFinance = kind === "finance";
  const title = isFinance ? "Relatório financeiro" : "Relatório operacional";
  const period = `${formatDate(filters.start)} até ${formatDate(filters.end)}`;
  const content = isFinance ? printableFinanceReport(rows) : printableOperationsReport(rows);
  const popup = window.open("", "_blank", "width=980,height=720");

  if (!popup) {
    toast("Não foi possível abrir a impressão. Verifique o bloqueador de pop-ups.");
    return;
  }

  popup.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; color: #18212f; margin: 28px; }
          h1 { margin: 0 0 6px; font-size: 24px; }
          p { margin: 0 0 18px; color: #667085; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { border-bottom: 1px solid #d9dee8; padding: 9px 8px; text-align: left; font-size: 12px; vertical-align: top; }
          th { background: #f4f7fb; color: #334155; }
          .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
          .card { border: 1px solid #d9dee8; border-radius: 8px; padding: 12px; }
          .card span { display: block; color: #667085; font-size: 12px; }
          .card strong { display: block; margin-top: 6px; font-size: 18px; }
          @media print { body { margin: 12mm; } button { display: none; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p>Período: ${escapeHtml(period)}</p>
        ${content}
        <script>window.print();<\/script>
      </body>
    </html>
  `);
  popup.document.close();
}

function printableOperationsReport(rows) {
  const completed = rows.quickExits.filter((item) => isCompletedStatus(item.status)).length;
  const open = rows.quickExits.filter((item) => normalizeStatus(item.status) === "aberta").length;
  return `
    <section class="summary">
      <div class="card"><span>Operações</span><strong>${rows.operations.length}</strong></div>
      <div class="card"><span>Agendamentos</span><strong>${rows.bookings.length}</strong></div>
      <div class="card"><span>Saídas rápidas</span><strong>${rows.quickExits.length}</strong></div>
      <div class="card"><span>Concluídas</span><strong>${completed}</strong></div>
      <div class="card"><span>Abertas</span><strong>${open}</strong></div>
    </section>
    <table>
      <thead><tr><th>Data</th><th>Tipo</th><th>Destino</th><th>Detalhe</th><th>Status</th></tr></thead>
      <tbody>
        ${rows.operations.map((item) => `
          <tr>
            <td>${escapeHtml(formatDateTime(item.date))}</td>
            <td>${escapeHtml(item.type)}</td>
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.detail)}</td>
            <td>${escapeHtml(item.status)}</td>
          </tr>
        `).join("") || '<tr><td colspan="5">Nenhum movimento no período.</td></tr>'}
      </tbody>
    </table>
  `;
}

function printableFinanceReport(rows) {
  const totalFuel = rows.finance.filter((item) => item.type === "Abastecimento").reduce((sum, item) => sum + item.value, 0);
  const totalMaintenance = rows.finance.filter((item) => item.type === "Manutenção").reduce((sum, item) => sum + item.value, 0);
  const totalAdvance = rows.finance.filter((item) => item.type === "Adiantamento").reduce((sum, item) => sum + item.value, 0);
  const totalSpent = rows.quickExits.reduce((sum, item) => sum + Number(item.spentAmount || 0), 0);
  return `
    <section class="summary">
      <div class="card"><span>Abastecimentos</span><strong>${currency.format(totalFuel)}</strong></div>
      <div class="card"><span>Manutenções</span><strong>${currency.format(totalMaintenance)}</strong></div>
      <div class="card"><span>Adiantado</span><strong>${currency.format(totalAdvance)}</strong></div>
      <div class="card"><span>Gasto em saídas</span><strong>${currency.format(totalSpent)}</strong></div>
    </section>
    <table>
      <thead><tr><th>Data</th><th>Tipo</th><th>Referência</th><th>Detalhe</th><th>Valor</th></tr></thead>
      <tbody>
        ${rows.finance.map((item) => `
          <tr>
            <td>${escapeHtml(formatDate(String(item.date).slice(0, 10)))}</td>
            <td>${escapeHtml(item.type)}</td>
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.detail)}</td>
            <td>${escapeHtml(currency.format(item.value))}</td>
          </tr>
        `).join("") || '<tr><td colspan="5">Nenhum lançamento financeiro no período.</td></tr>'}
      </tbody>
    </table>
  `;
}

function reportFilters() {
  return {
    start: document.getElementById("reportStart")?.value || firstDayOfCurrentMonth(),
    end: document.getElementById("reportEnd")?.value || toDateValue(new Date()),
    vehicleId: document.getElementById("reportVehicle")?.value || "",
    driverId: document.getElementById("reportDriver")?.value || ""
  };
}

function isInReportPeriod(dateValue, filters) {
  if (!dateValue) return false;
  const value = String(dateValue).slice(0, 10);
  return value >= filters.start && value <= filters.end;
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeText(value) {
  return normalizeStatus(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function isCompletedStatus(value) {
  return ["concluida", "concluido", "finalizada", "finalizado"].includes(normalizeStatus(value));
}

function firstDayOfCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function isCurrentMonth(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function renderBars(id, rows) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  document.getElementById(id).innerHTML = rows.map((row) => `
    <div class="bar-row">
      <div class="bar-top"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(row.detail)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max((row.value / max) * 100, row.value ? 8 : 0)}%"></div></div>
    </div>
  `).join("");
}

function renderList(id, rows, template) {
  const element = document.getElementById(id);
  if (!rows.length) {
    element.innerHTML = '<div class="empty-state">Nenhum registro encontrado.</div>';
    return;
  }

  element.innerHTML = rows.map(template).join("");
  element.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => removeRecord(button.dataset.remove, button.dataset.id));
  });
  element.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => editRecord(button.dataset.edit, button.dataset.id));
  });
  element.querySelectorAll("[data-close-exit]").forEach((button) => {
    button.addEventListener("click", () => closeQuickExit(button.dataset.closeExit));
  });
  element.querySelectorAll("[data-mobile-return]").forEach((button) => {
    button.addEventListener("click", () => returnMobileExit(button.dataset.mobileReturn));
  });
  element.querySelectorAll("[data-start-quick-exit]").forEach((button) => {
    button.addEventListener("click", () => startQuickExitForVehicle(button.dataset.startQuickExit));
  });
  element.querySelectorAll("[data-complete-maintenance]").forEach((button) => {
    button.addEventListener("click", () => completeMaintenance(button.dataset.completeMaintenance));
  });
  element.querySelectorAll("[data-go-maintenance]").forEach((button) => {
    button.addEventListener("click", () => editRecord("maintenance", button.dataset.goMaintenance));
  });
  element.querySelectorAll("[data-start-document]").forEach((button) => {
    button.addEventListener("click", () => startDocumentForRequirement(button.dataset.startDocument, button.dataset.ownerId, button.dataset.documentType));
  });
}

function buildAlerts() {
  const now = new Date();
  const inThirtyDays = new Date(now);
  inThirtyDays.setDate(now.getDate() + 30);
  const alerts = [];

  data.drivers.forEach((driver) => {
    const due = new Date(`${driver.licenseDue}T00:00:00`);
    if (due <= inThirtyDays) {
      alerts.push({
        title: `CNH de ${driver.name}`,
        detail: `Vencimento em ${formatDate(driver.licenseDue)}.`,
        label: due < now ? "Vencida" : "Vence logo",
        tone: due < now ? "danger" : "warn"
      });
    }
  });

  data.maintenance.filter((item) => item.status !== "Concluída").forEach((item) => {
    alerts.push({
      title: `${vehicleLabel(findVehicle(item.vehicleId))} em manutenção`,
      detail: `${item.type}: ${item.description}.`,
      label: item.status,
      tone: item.status === "Aberta" ? "danger" : "warn"
    });
  });

  (data.documents || []).forEach((documentItem) => {
    const status = documentStatus(documentItem);
    if (status.days <= 30) {
      alerts.push({
        title: `${documentItem.type} - ${documentItem.name}`,
        detail: `${documentOwnerLabel(documentItem)}: ${status.detail}.`,
        label: status.label,
        tone: status.tone
      });
    }
  });

  requiredDocumentGaps().slice(0, 8).forEach((item) => {
    alerts.push({
      title: `${item.type} não cadastrado`,
      detail: item.reason,
      label: "Faltando",
      tone: "danger"
    });
  });

  return alerts;
}

function filterRows(rows, textFactory) {
  if (!searchTerm) return rows;
  return rows.filter((row) => textFactory(row).toLowerCase().includes(searchTerm));
}

function findVehicle(id) {
  return data.vehicles.find((vehicle) => vehicle.id === id);
}

function findDriver(id) {
  return data.drivers.find((driver) => driver.id === id);
}

function vehicleLabel(vehicle) {
  return vehicle ? `${vehicle.plate} - ${vehicle.model}` : "Veículo removido";
}

function driverLabel(driver) {
  return driver ? driver.name : "Motorista removido";
}

function documentOwnerLabel(item) {
  if (item.ownerType === "driver") return driverLabel(findDriver(item.ownerId));
  return vehicleLabel(findVehicle(item.ownerId));
}

function documentStatus(item) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${item.dueDate}T00:00:00`);
  const days = Math.ceil((due - today) / 86400000);

  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      days,
      tone: "danger",
      label: "Vencido",
      detail: overdue === 1 ? "vencido há 1 dia" : `vencido há ${overdue} dias`
    };
  }

  if (days <= 30) {
    return {
      days,
      tone: "warn",
      label: "Vence logo",
      detail: days === 0 ? "vence hoje" : `vence em ${days} dia(s)`
    };
  }

  return {
    days,
    tone: "ok",
    label: "Em dia",
    detail: `vence em ${days} dia(s)`
  };
}

function requiredDocumentGaps() {
  const requirements = [
    ...data.vehicles.flatMap((vehicle) => ["CRLV", "Seguro", "Licenciamento"].map((type) => ({
      ownerType: "vehicle",
      ownerId: vehicle.id,
      ownerLabel: vehicleLabel(vehicle),
      type
    }))),
    ...data.drivers.map((driver) => ({
      ownerType: "driver",
      ownerId: driver.id,
      ownerLabel: driverLabel(driver),
      type: "CNH"
    }))
  ];

  return requirements.filter((required) => {
    const current = (data.documents || []).some((item) => {
      if (item.ownerType !== required.ownerType || item.ownerId !== required.ownerId || item.type !== required.type) return false;
      return documentStatus(item).days >= 0;
    });
    return !current;
  }).map((item) => ({
    ...item,
    reason: `${item.ownerLabel} não possui ${item.type} válido cadastrado.`
  }));
}

function entityLabel(entity) {
  const labels = {
    vehicles: "veículo",
    drivers: "motorista",
    bookings: "agendamento",
    quickExits: "saída rápida",
    fuel: "abastecimento",
    maintenance: "manutenção",
    checklists: "checklist",
    documents: "documento",
    users: "usuário",
    sistema: "sistema"
  };
  return labels[entity] || entity;
}

function statusTone(status) {
  const normalized = normalizeStatus(status);
  if (["disponivel", "ativo", "concluida", "concluido"].includes(normalized)) return "ok";
  if (["manutencao", "bloqueado", "cancelada"].includes(normalized)) return "danger";
  if (["agendada", "ferias", "em uso", "com ressalva", "aberta", "aguardando conferencia"].includes(normalized)) return "warn";
  return "";
}

function computedVehicleStatus(vehicle) {
  const openMaintenance = data.maintenance.some((item) => item.vehicleId === vehicle.id && item.status !== "Concluída");
  if (openMaintenance) return { status: "Manutenção", reason: "Manutenção aberta" };
  if (vehicle.status === "Manutenção") return { status: "Manutenção", reason: "Status do cadastro" };

  const blockedChecklist = (data.checklists || [])
    .filter((item) => item.vehicleId === vehicle.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  if (blockedChecklist?.status === "Bloqueado") return { status: "Bloqueado", reason: "Último checklist bloqueado" };

  const activeBooking = data.bookings.find((booking) => booking.vehicleId === vehicle.id && isNowBetween(booking.start, booking.end));
  if (activeBooking) return { status: "Em uso", reason: activeBooking.destination };

  const activeQuickExit = (data.quickExits || []).find((item) => item.vehicleId === vehicle.id && normalizeStatus(item.status) === "aberta");
  if (activeQuickExit) return { status: "Em uso", reason: `Saída rápida: ${activeQuickExit.destination}` };

  const nextBooking = data.bookings
    .filter((booking) => booking.vehicleId === vehicle.id && new Date(booking.start) > new Date())
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  if (nextBooking) return { status: "Agendada", reason: formatDateTime(nextBooking.start) };

  if (vehicle.status === "Inativo") return { status: "Inativo", reason: "Cadastro inativo" };
  return { status: "Disponível", reason: "Sem pendências" };
}

function quickExitConflict(vehicleId, ignoreQuickExitId = "") {
  const vehicle = findVehicle(vehicleId);
  if (!vehicle) return "Veículo não encontrado.";

  const computed = computedVehicleStatus(vehicle);
  if (computed.status !== "Disponível" && computed.status !== "Agendada") {
    return `Este veículo não pode sair agora: ${computed.status} (${computed.reason}).`;
  }

  if (vehicle.status === "Inativo") {
    return "Este veículo está inativo.";
  }

  const activeBooking = data.bookings.find((booking) => booking.vehicleId === vehicleId && isNowBetween(booking.start, booking.end));
  if (activeBooking) {
    return `Este veículo está em agendamento agora: ${activeBooking.destination}.`;
  }

  const activeQuickExit = (data.quickExits || []).find((item) => item.id !== ignoreQuickExitId && item.vehicleId === vehicleId && normalizeStatus(item.status) === "aberta");
  if (activeQuickExit) {
    return `Este veículo já possui saída rápida aberta: ${activeQuickExit.destination}.`;
  }

  const openMaintenance = data.maintenance.find((item) => item.vehicleId === vehicleId && normalizeStatus(item.status) !== "concluida");
  if (openMaintenance) {
    return `Este veículo possui manutenção aberta: ${openMaintenance.type}.`;
  }

  const blockedChecklist = (data.checklists || [])
    .filter((item) => item.vehicleId === vehicleId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  if (blockedChecklist?.status === "Bloqueado") {
    return "Este veículo está bloqueado pelo último checklist.";
  }

  return "";
}

function isNowBetween(start, end) {
  const now = new Date();
  return new Date(start) <= now && now <= new Date(end);
}

function isDueSoon(dateValue) {
  const now = new Date();
  const due = new Date(`${dateValue}T00:00:00`);
  const inThirtyDays = new Date(now);
  inThirtyDays.setDate(now.getDate() + 30);
  return due <= inThirtyDays;
}

function formatDate(value) {
  return dateOnly.format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  return dateTime.format(new Date(value));
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function exportCsv() {
  const lines = [
    ["modulo", "placa_ou_nome", "modelo_departamento", "motorista", "destino_local", "status_tipo", "data_inicio", "data_fim", "valor_adiantado", "combustivel", "alimentacao", "outras_despesas", "valor_devolvido", "valor_total", "observacoes", "latitude_devolucao", "longitude_devolucao", "precisao_metros", "data_localizacao"],
    ...data.vehicles.map((item) => ["veiculo", item.plate, item.model, "", item.costCenter, item.status, "", "", "", "", "", "", "", "", "", "", "", "", ""]),
    ...data.drivers.map((item) => ["motorista", item.name, item.department, "", "", item.status, item.licenseDue, "", "", "", "", "", "", "", `CNH ${item.license || ""}`, "", "", "", ""]),
    ...data.bookings.map((item) => ["agendamento", vehicleLabel(findVehicle(item.vehicleId)), "", driverLabel(findDriver(item.driverId)), item.destination, item.purpose, item.start, item.end, "", "", "", "", "", "", "", "", "", "", ""]),
    ...(data.quickExits || []).map((item) => ["saida_rapida", vehicleLabel(findVehicle(item.vehicleId)), "", driverLabel(findDriver(item.driverId)), item.destination, item.status, item.departureAt, item.returnedAt || "", item.advanceAmount || 0, item.fuelExpense || 0, item.foodExpense || 0, item.otherExpense || 0, item.returnedAmount || 0, item.spentAmount || 0, item.reason || item.notes || "", item.returnLatitude ?? "", item.returnLongitude ?? "", item.returnAccuracy ?? "", item.returnLocationAt || ""]),
    ...data.fuel.map((item) => ["abastecimento", vehicleLabel(findVehicle(item.vehicleId)), "", "", item.station, "abastecimento", item.date, "", "", "", "", "", "", item.total, `${item.liters || 0} litros`, "", "", "", ""]),
    ...data.maintenance.map((item) => ["manutencao", vehicleLabel(findVehicle(item.vehicleId)), "", "", "", item.status, item.date, item.nextDue || "", "", "", "", "", "", item.cost, `${item.type} - ${item.description}`, "", "", "", ""]),
    ...(data.checklists || []).map((item) => ["checklist", vehicleLabel(findVehicle(item.vehicleId)), "", driverLabel(findDriver(item.driverId)), "", item.status, item.date, "", "", "", "", "", "", "", item.type, "", "", "", ""]),
    ...(data.documents || []).map((item) => ["documento", documentOwnerLabel(item), item.name, "", "", item.type, item.dueDate, "", "", "", "", "", "", "", item.fileRef || item.notes || "", "", "", "", ""])
  ];

  const csv = `sep=;\r\n${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "am3-fleet-export.csv";
  link.click();
  URL.revokeObjectURL(url);
  toast("CSV gerado.");
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").replaceAll('"', '""');
  return `"${text}"`;
}

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
