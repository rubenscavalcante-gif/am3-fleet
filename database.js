const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const dataDir = path.join(root, "data");
const sqlitePath = path.join(dataDir, "fleetdesk.sqlite");
const seedPath = path.join(dataDir, "db.json");
const collectionNames = ["users", "vehicles", "drivers", "bookings", "quickExits", "fuel", "maintenance", "checklists", "documents", "auditLogs", "sessions"];
const dbType = (process.env.DB_TYPE || "sqlite").toLowerCase();
const sqlServerMode = (process.env.DB_SQLSERVER_MODE || "records").toLowerCase();

let sqliteDatabase;
let sqlServer;
let sqlPool;
let postgres;
let postgresPool;

async function initDb() {
  if (dbType === "postgres" || dbType === "postgresql") {
    await initPostgres();
    return;
  }

  if (dbType === "sqlserver") {
    await initSqlServer();
    return;
  }

  initSqlite();
}

async function readDb() {
  if (dbType === "postgres" || dbType === "postgresql") return readPostgresDb();
  if (dbType === "sqlserver" && sqlServerMode === "relational") return readSqlServerRelationalDb();
  if (dbType === "sqlserver") return readSqlServerDb();
  return readSqliteDb();
}

async function writeDb(state) {
  if (dbType === "postgres" || dbType === "postgresql") {
    await writePostgresDb(state);
    return;
  }

  if (dbType === "sqlserver" && sqlServerMode === "relational") {
    await writeSqlServerRelationalDb(state);
    return;
  }
  if (dbType === "sqlserver") {
    await writeSqlServerDb(state);
    return;
  }

  writeSqliteDb(state);
}

async function dbInfo() {
  if (dbType === "postgres" || dbType === "postgresql") {
    const pool = await getPostgresPool();
    const result = await pool.query("SELECT COUNT(*)::int AS total FROM public.am3_fleet_records");
    return {
      type: "postgres",
      mode: "records",
      server: process.env.DB_HOST || "connection-string",
      database: process.env.DB_DATABASE || "",
      records: result.rows[0].total
    };
  }

  if (dbType === "sqlserver") {
    const pool = await getSqlPool();
    const tableName = sqlServerMode === "relational" ? "FleetDeskVeiculos" : "FleetDeskRecords";
    const result = await pool.request().query(`SELECT COUNT(*) AS total FROM dbo.${tableName}`);
    return {
      type: "sqlserver",
      mode: sqlServerMode,
      server: process.env.DB_HOST || "localhost",
      database: process.env.DB_DATABASE || "",
      records: result.recordset[0].total
    };
  }

  const count = sqliteDatabase.prepare("SELECT COUNT(*) AS total FROM records").get().total;
  return { type: "sqlite", path: sqlitePath, records: count };
}

function initSqlite() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  sqliteDatabase = new DatabaseSync(sqlitePath);
  sqliteDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);
  `);

  if (isSqliteEmpty() && fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    writeSqliteDb(seed);
  }
}

function readSqliteDb() {
  ensureSqlite();
  const db = emptyState();
  const rows = sqliteDatabase.prepare("SELECT collection, payload FROM records ORDER BY created_at ASC").all();

  rows.forEach((row) => {
    if (!db[row.collection]) db[row.collection] = [];
    db[row.collection].push(JSON.parse(row.payload));
  });

  return db;
}

function writeSqliteDb(state) {
  ensureSqlite();
  const replace = sqliteDatabase.prepare(`
    INSERT INTO records (collection, id, payload, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(collection, id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = CURRENT_TIMESTAMP
  `);
  const removeCollection = sqliteDatabase.prepare("DELETE FROM records WHERE collection = ?");
  sqliteDatabase.exec("BEGIN");
  try {
    collectionNames.forEach((collection) => {
      removeCollection.run(collection);
      (state[collection] || []).forEach((record) => {
        replace.run(collection, record.id, JSON.stringify(record));
      });
    });
    sqliteDatabase.exec("COMMIT");
  } catch (error) {
    sqliteDatabase.exec("ROLLBACK");
    throw error;
  }
}

function ensureSqlite() {
  if (!sqliteDatabase) initSqlite();
}

function isSqliteEmpty() {
  return sqliteDatabase.prepare("SELECT COUNT(*) AS total FROM records").get().total === 0;
}

async function initPostgres() {
  postgres = require("pg");
  const pool = await getPostgresPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.am3_fleet_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT am3_fleet_records_pk PRIMARY KEY (collection, id)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS am3_fleet_records_collection_idx ON public.am3_fleet_records(collection)");

  const result = await pool.query("SELECT COUNT(*)::int AS total FROM public.am3_fleet_records");
  if (result.rows[0].total === 0 && fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    await writePostgresDb(seed);
  }
}

async function readPostgresDb() {
  const pool = await getPostgresPool();
  const db = emptyState();
  const result = await pool.query("SELECT collection, payload FROM public.am3_fleet_records ORDER BY created_at ASC");

  result.rows.forEach((row) => {
    if (!db[row.collection]) db[row.collection] = [];
    db[row.collection].push(typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload);
  });

  return db;
}

async function writePostgresDb(state) {
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    for (const collection of collectionNames) {
      await client.query("DELETE FROM public.am3_fleet_records WHERE collection = $1", [collection]);

      for (const record of state[collection] || []) {
        await client.query(`
          INSERT INTO public.am3_fleet_records (collection, id, payload, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
          ON CONFLICT (collection, id) DO UPDATE SET
            payload = EXCLUDED.payload,
            updated_at = NOW()
        `, [collection, record.id, JSON.stringify(record)]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initSqlServer() {
  sqlServer = require("mssql");
  const pool = await getSqlPool();

  if (sqlServerMode === "relational") {
    await assertRelationalSchema(pool);
    return;
  }

  await pool.request().query(`
    IF OBJECT_ID('dbo.FleetDeskRecords', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.FleetDeskRecords (
        collection NVARCHAR(40) NOT NULL,
        id NVARCHAR(80) NOT NULL,
        payload NVARCHAR(MAX) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_FleetDeskRecords PRIMARY KEY (collection, id)
      );
      CREATE INDEX IX_FleetDeskRecords_collection ON dbo.FleetDeskRecords(collection);
    END
  `);

  const result = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.FleetDeskRecords");
  if (result.recordset[0].total === 0 && fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    await writeSqlServerDb(seed);
  }
}

async function assertRelationalSchema(pool) {
  const requiredTables = [
    "FleetDeskUsuarios",
    "FleetDeskVeiculos",
    "FleetDeskMotoristas",
    "FleetDeskAgendamentos",
    "FleetDeskSaidasRapidas",
    "FleetDeskAbastecimentos",
    "FleetDeskManutencoes",
    "FleetDeskChecklists",
    "FleetDeskDocumentos",
    "FleetDeskAuditoria"
  ];
  const result = await pool.request().query(`
    SELECT name
    FROM sys.tables
    WHERE name IN (${requiredTables.map((name) => `'${name}'`).join(",")})
  `);
  const found = new Set(result.recordset.map((row) => row.name));
  const missing = requiredTables.filter((name) => !found.has(name));

  if (missing.length) {
    throw new Error(`Tabelas relacionais ausentes: ${missing.join(", ")}. Execute scripts/sqlserver-relational-schema.sql e a migracao antes de iniciar.`);
  }
}

async function readSqlServerDb() {
  const pool = await getSqlPool();
  const db = emptyState();
  const result = await pool.request().query("SELECT collection, payload FROM dbo.FleetDeskRecords ORDER BY created_at ASC");

  result.recordset.forEach((row) => {
    if (!db[row.collection]) db[row.collection] = [];
    db[row.collection].push(JSON.parse(row.payload));
  });

  return db;
}

async function readSqlServerRelationalDb() {
  const pool = await getSqlPool();
  const db = emptyState();

  db.users = (await pool.request().query(`
    SELECT Id, Nome, Email, SenhaHash, Perfil
    FROM dbo.FleetDeskUsuarios
    ORDER BY CriadoEm ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    name: row.Nome,
    email: row.Email,
    passwordHash: row.SenhaHash,
    role: row.Perfil
  }));

  db.vehicles = (await pool.request().query(`
    SELECT Id, Placa, Modelo, Ano, Hodometro, StatusCadastro, CentroCusto
    FROM dbo.FleetDeskVeiculos
    ORDER BY CriadoEm ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    plate: row.Placa,
    model: row.Modelo,
    year: row.Ano,
    odometer: row.Hodometro,
    status: row.StatusCadastro,
    costCenter: row.CentroCusto
  }));

  db.drivers = (await pool.request().query(`
    SELECT Id, Nome, Telefone, Cnh, ValidadeCnh, StatusCadastro, Departamento
    FROM dbo.FleetDeskMotoristas
    ORDER BY CriadoEm ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    name: row.Nome,
    phone: row.Telefone,
    license: row.Cnh,
    licenseDue: toDateValue(row.ValidadeCnh),
    status: row.StatusCadastro,
    department: row.Departamento
  }));

  db.bookings = (await pool.request().query(`
    SELECT Id, VeiculoId, MotoristaId, Inicio, Fim, Destino, Objetivo
    FROM dbo.FleetDeskAgendamentos
    ORDER BY Inicio ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    vehicleId: row.VeiculoId,
    driverId: row.MotoristaId,
    start: toDateTimeValue(row.Inicio),
    end: toDateTimeValue(row.Fim),
    destination: row.Destino,
    purpose: row.Objetivo
  }));

  db.quickExits = (await pool.request().query(`
    SELECT Id, VeiculoId, MotoristaId, SaidaEm, RetornoEm, Destino, Motivo, ValorAdiantado, FinalidadeValor, ValorGasto, GastoCombustivel, GastoAlimentacao, GastoOutros, ValorDevolvido, ComprovanteReferencia, HodometroSaida, HodometroRetorno, Observacoes, StatusSaida
    FROM dbo.FleetDeskSaidasRapidas
    ORDER BY SaidaEm ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    vehicleId: row.VeiculoId,
    driverId: row.MotoristaId,
    departureAt: toDateTimeValue(row.SaidaEm),
    returnedAt: row.RetornoEm ? toDateTimeValue(row.RetornoEm) : "",
    destination: row.Destino,
    reason: row.Motivo,
    advanceAmount: Number(row.ValorAdiantado || 0),
    advancePurpose: row.FinalidadeValor,
    fuelExpense: Number(row.GastoCombustivel || 0),
    foodExpense: Number(row.GastoAlimentacao || 0),
    otherExpense: Number(row.GastoOutros || 0),
    spentAmount: Number(row.ValorGasto || 0),
    returnedAmount: Number(row.ValorDevolvido || 0),
    receiptRef: row.ComprovanteReferencia || "",
    odometerOut: row.HodometroSaida,
    odometerIn: row.HodometroRetorno,
    notes: row.Observacoes || "",
    status: row.StatusSaida
  }));

  db.fuel = (await pool.request().query(`
    SELECT Id, VeiculoId, DataAbastecimento, Litros, ValorTotal, Hodometro, Posto
    FROM dbo.FleetDeskAbastecimentos
    ORDER BY DataAbastecimento ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    vehicleId: row.VeiculoId,
    date: toDateValue(row.DataAbastecimento),
    liters: Number(row.Litros),
    total: Number(row.ValorTotal),
    odometer: row.Hodometro,
    station: row.Posto || ""
  }));

  db.maintenance = (await pool.request().query(`
    SELECT Id, VeiculoId, Tipo, DataManutencao, Valor, StatusManutencao, ProximaRevisao, Descricao
    FROM dbo.FleetDeskManutencoes
    ORDER BY DataManutencao ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    vehicleId: row.VeiculoId,
    type: row.Tipo,
    date: toDateValue(row.DataManutencao),
    cost: Number(row.Valor),
    status: row.StatusManutencao,
    nextDue: toDateValue(row.ProximaRevisao),
    description: row.Descricao
  }));

  db.checklists = (await pool.request().query(`
    SELECT Id, VeiculoId, MotoristaId, Tipo, DataChecklist, Hodometro, NivelCombustivel, PneusOk, LuzesOk, DocumentosOk, LimpezaOk, Observacoes, StatusChecklist
    FROM dbo.FleetDeskChecklists
    ORDER BY DataChecklist ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    vehicleId: row.VeiculoId,
    driverId: row.MotoristaId,
    type: row.Tipo,
    date: toDateTimeValue(row.DataChecklist),
    odometer: row.Hodometro,
    fuelLevel: row.NivelCombustivel,
    tires: Boolean(row.PneusOk),
    lights: Boolean(row.LuzesOk),
    documents: Boolean(row.DocumentosOk),
    cleanliness: Boolean(row.LimpezaOk),
    notes: row.Observacoes || "",
    status: row.StatusChecklist
  }));

  db.documents = (await pool.request().query(`
    SELECT Id, TipoVinculo, RegistroId, TipoDocumento, Nome, Vencimento, ArquivoReferencia, Observacoes
    FROM dbo.FleetDeskDocumentos
    ORDER BY Vencimento ASC
  `)).recordset.map((row) => ({
    id: row.Id,
    ownerType: row.TipoVinculo,
    ownerId: row.RegistroId,
    type: row.TipoDocumento,
    name: row.Nome,
    dueDate: toDateValue(row.Vencimento),
    fileRef: row.ArquivoReferencia || "",
    notes: row.Observacoes || ""
  }));

  db.auditLogs = (await pool.request().query(`
    SELECT Id, UsuarioId, UsuarioEmail, Acao, Entidade, RegistroId, Resumo, CriadoEm
    FROM dbo.FleetDeskAuditoria
    ORDER BY CriadoEm DESC
  `)).recordset.map((row) => ({
    id: row.Id,
    userId: row.UsuarioId,
    userEmail: row.UsuarioEmail,
    action: row.Acao,
    entity: row.Entidade,
    recordId: row.RegistroId,
    summary: row.Resumo || "",
    createdAt: toDateTimeValue(row.CriadoEm)
  }));

  return db;
}

async function writeSqlServerDb(state) {
  const pool = await getSqlPool();
  const transaction = new sqlServer.Transaction(pool);

  await transaction.begin();
  try {
    for (const collection of collectionNames) {
      await new sqlServer.Request(transaction)
        .input("collection", sqlServer.NVarChar(40), collection)
        .query("DELETE FROM dbo.FleetDeskRecords WHERE collection = @collection");

      for (const record of state[collection] || []) {
        await new sqlServer.Request(transaction)
          .input("collection", sqlServer.NVarChar(40), collection)
          .input("id", sqlServer.NVarChar(80), record.id)
          .input("payload", sqlServer.NVarChar(sqlServer.MAX), JSON.stringify(record))
          .query(`
            INSERT INTO dbo.FleetDeskRecords (collection, id, payload, updated_at)
            VALUES (@collection, @id, @payload, GETDATE())
          `);
      }
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function writeSqlServerRelationalDb(state) {
  const pool = await getSqlPool();
  const transaction = new sqlServer.Transaction(pool);

  await transaction.begin();
  try {
    await deleteRelationalData(transaction);
    await insertRelationalUsers(transaction, state.users || []);
    await insertRelationalVehicles(transaction, state.vehicles || []);
    await insertRelationalDrivers(transaction, state.drivers || []);
    await insertRelationalBookings(transaction, state.bookings || []);
    await insertRelationalQuickExits(transaction, state.quickExits || []);
    await insertRelationalFuel(transaction, state.fuel || []);
    await insertRelationalMaintenance(transaction, state.maintenance || []);
    await insertRelationalChecklists(transaction, state.checklists || []);
    await insertRelationalDocuments(transaction, state.documents || []);
    await insertRelationalAuditLogs(transaction, state.auditLogs || []);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function deleteRelationalData(transaction) {
  const tables = [
    "FleetDeskAuditoria",
    "FleetDeskDocumentos",
    "FleetDeskChecklists",
    "FleetDeskManutencoes",
    "FleetDeskAbastecimentos",
    "FleetDeskSaidasRapidas",
    "FleetDeskAgendamentos",
    "FleetDeskMotoristas",
    "FleetDeskVeiculos",
    "FleetDeskUsuarios"
  ];

  for (const table of tables) {
    await new sqlServer.Request(transaction).query(`DELETE FROM dbo.${table}`);
  }
}

async function insertRelationalUsers(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("Nome", sqlServer.NVarChar(160), row.name)
      .input("Email", sqlServer.NVarChar(180), row.email)
      .input("SenhaHash", sqlServer.NVarChar(128), row.passwordHash)
      .input("Perfil", sqlServer.NVarChar(40), row.role)
      .query("INSERT INTO dbo.FleetDeskUsuarios (Id, Nome, Email, SenhaHash, Perfil) VALUES (@Id, @Nome, @Email, @SenhaHash, @Perfil)");
  }
}

async function insertRelationalVehicles(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("Placa", sqlServer.NVarChar(20), row.plate)
      .input("Modelo", sqlServer.NVarChar(160), row.model)
      .input("Ano", sqlServer.Int, Number(row.year || 0))
      .input("Hodometro", sqlServer.Int, Number(row.odometer || 0))
      .input("StatusCadastro", sqlServer.NVarChar(40), row.status)
      .input("CentroCusto", sqlServer.NVarChar(120), row.costCenter)
      .query("INSERT INTO dbo.FleetDeskVeiculos (Id, Placa, Modelo, Ano, Hodometro, StatusCadastro, CentroCusto) VALUES (@Id, @Placa, @Modelo, @Ano, @Hodometro, @StatusCadastro, @CentroCusto)");
  }
}

async function insertRelationalDrivers(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("Nome", sqlServer.NVarChar(160), row.name)
      .input("Telefone", sqlServer.NVarChar(40), row.phone)
      .input("Cnh", sqlServer.NVarChar(40), row.license)
      .input("ValidadeCnh", sqlServer.DateTime, parseDbDate(row.licenseDue))
      .input("StatusCadastro", sqlServer.NVarChar(40), row.status)
      .input("Departamento", sqlServer.NVarChar(120), row.department)
      .query("INSERT INTO dbo.FleetDeskMotoristas (Id, Nome, Telefone, Cnh, ValidadeCnh, StatusCadastro, Departamento) VALUES (@Id, @Nome, @Telefone, @Cnh, @ValidadeCnh, @StatusCadastro, @Departamento)");
  }
}

async function insertRelationalBookings(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("VeiculoId", sqlServer.NVarChar(80), row.vehicleId)
      .input("MotoristaId", sqlServer.NVarChar(80), row.driverId)
      .input("Inicio", sqlServer.DateTime, parseDbDate(row.start))
      .input("Fim", sqlServer.DateTime, parseDbDate(row.end))
      .input("Destino", sqlServer.NVarChar(240), row.destination)
      .input("Objetivo", sqlServer.NVarChar(240), row.purpose)
      .query("INSERT INTO dbo.FleetDeskAgendamentos (Id, VeiculoId, MotoristaId, Inicio, Fim, Destino, Objetivo) VALUES (@Id, @VeiculoId, @MotoristaId, @Inicio, @Fim, @Destino, @Objetivo)");
  }
}

async function insertRelationalQuickExits(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("VeiculoId", sqlServer.NVarChar(80), row.vehicleId)
      .input("MotoristaId", sqlServer.NVarChar(80), row.driverId)
      .input("SaidaEm", sqlServer.DateTime, parseDbDate(row.departureAt))
      .input("RetornoEm", sqlServer.DateTime, row.returnedAt ? parseDbDate(row.returnedAt) : null)
      .input("Destino", sqlServer.NVarChar(240), row.destination)
      .input("Motivo", sqlServer.NVarChar(240), row.reason)
      .input("ValorAdiantado", sqlServer.Decimal(12, 2), Number(row.advanceAmount || 0))
      .input("FinalidadeValor", sqlServer.NVarChar(120), row.advancePurpose)
      .input("GastoCombustivel", sqlServer.Decimal(12, 2), Number(row.fuelExpense || 0))
      .input("GastoAlimentacao", sqlServer.Decimal(12, 2), Number(row.foodExpense || 0))
      .input("GastoOutros", sqlServer.Decimal(12, 2), Number(row.otherExpense || 0))
      .input("ValorGasto", sqlServer.Decimal(12, 2), Number(row.spentAmount || (Number(row.fuelExpense || 0) + Number(row.foodExpense || 0) + Number(row.otherExpense || 0))))
      .input("ValorDevolvido", sqlServer.Decimal(12, 2), Number(row.returnedAmount || 0))
      .input("ComprovanteReferencia", sqlServer.NVarChar(240), row.receiptRef || null)
      .input("HodometroSaida", sqlServer.Int, row.odometerOut === null || row.odometerOut === undefined ? null : Number(row.odometerOut))
      .input("HodometroRetorno", sqlServer.Int, row.odometerIn === null || row.odometerIn === undefined ? null : Number(row.odometerIn))
      .input("Observacoes", sqlServer.NVarChar(500), row.notes || null)
      .input("StatusSaida", sqlServer.NVarChar(40), row.status)
      .query("INSERT INTO dbo.FleetDeskSaidasRapidas (Id, VeiculoId, MotoristaId, SaidaEm, RetornoEm, Destino, Motivo, ValorAdiantado, FinalidadeValor, ValorGasto, GastoCombustivel, GastoAlimentacao, GastoOutros, ValorDevolvido, ComprovanteReferencia, HodometroSaida, HodometroRetorno, Observacoes, StatusSaida) VALUES (@Id, @VeiculoId, @MotoristaId, @SaidaEm, @RetornoEm, @Destino, @Motivo, @ValorAdiantado, @FinalidadeValor, @ValorGasto, @GastoCombustivel, @GastoAlimentacao, @GastoOutros, @ValorDevolvido, @ComprovanteReferencia, @HodometroSaida, @HodometroRetorno, @Observacoes, @StatusSaida)");
  }
}

async function insertRelationalFuel(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("VeiculoId", sqlServer.NVarChar(80), row.vehicleId)
      .input("DataAbastecimento", sqlServer.DateTime, parseDbDate(row.date))
      .input("Litros", sqlServer.Decimal(12, 2), Number(row.liters || 0))
      .input("ValorTotal", sqlServer.Decimal(12, 2), Number(row.total || 0))
      .input("Hodometro", sqlServer.Int, row.odometer === null || row.odometer === undefined ? null : Number(row.odometer))
      .input("Posto", sqlServer.NVarChar(160), row.station || null)
      .query("INSERT INTO dbo.FleetDeskAbastecimentos (Id, VeiculoId, DataAbastecimento, Litros, ValorTotal, Hodometro, Posto) VALUES (@Id, @VeiculoId, @DataAbastecimento, @Litros, @ValorTotal, @Hodometro, @Posto)");
  }
}

async function insertRelationalMaintenance(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("VeiculoId", sqlServer.NVarChar(80), row.vehicleId)
      .input("Tipo", sqlServer.NVarChar(60), row.type)
      .input("DataManutencao", sqlServer.DateTime, parseDbDate(row.date))
      .input("Valor", sqlServer.Decimal(12, 2), Number(row.cost || 0))
      .input("StatusManutencao", sqlServer.NVarChar(40), row.status)
      .input("ProximaRevisao", sqlServer.DateTime, parseDbDate(row.nextDue))
      .input("Descricao", sqlServer.NVarChar(500), row.description)
      .query("INSERT INTO dbo.FleetDeskManutencoes (Id, VeiculoId, Tipo, DataManutencao, Valor, StatusManutencao, ProximaRevisao, Descricao) VALUES (@Id, @VeiculoId, @Tipo, @DataManutencao, @Valor, @StatusManutencao, @ProximaRevisao, @Descricao)");
  }
}

async function insertRelationalChecklists(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("VeiculoId", sqlServer.NVarChar(80), row.vehicleId)
      .input("MotoristaId", sqlServer.NVarChar(80), row.driverId)
      .input("Tipo", sqlServer.NVarChar(40), row.type)
      .input("DataChecklist", sqlServer.DateTime, parseDbDate(row.date))
      .input("Hodometro", sqlServer.Int, Number(row.odometer || 0))
      .input("NivelCombustivel", sqlServer.NVarChar(40), row.fuelLevel)
      .input("PneusOk", sqlServer.Bit, Boolean(row.tires))
      .input("LuzesOk", sqlServer.Bit, Boolean(row.lights))
      .input("DocumentosOk", sqlServer.Bit, Boolean(row.documents))
      .input("LimpezaOk", sqlServer.Bit, Boolean(row.cleanliness))
      .input("Observacoes", sqlServer.NVarChar(500), row.notes || null)
      .input("StatusChecklist", sqlServer.NVarChar(40), row.status)
      .query("INSERT INTO dbo.FleetDeskChecklists (Id, VeiculoId, MotoristaId, Tipo, DataChecklist, Hodometro, NivelCombustivel, PneusOk, LuzesOk, DocumentosOk, LimpezaOk, Observacoes, StatusChecklist) VALUES (@Id, @VeiculoId, @MotoristaId, @Tipo, @DataChecklist, @Hodometro, @NivelCombustivel, @PneusOk, @LuzesOk, @DocumentosOk, @LimpezaOk, @Observacoes, @StatusChecklist)");
  }
}

async function insertRelationalDocuments(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("TipoVinculo", sqlServer.NVarChar(20), row.ownerType)
      .input("RegistroId", sqlServer.NVarChar(80), row.ownerId)
      .input("TipoDocumento", sqlServer.NVarChar(80), row.type)
      .input("Nome", sqlServer.NVarChar(180), row.name)
      .input("Vencimento", sqlServer.DateTime, parseDbDate(row.dueDate))
      .input("ArquivoReferencia", sqlServer.NVarChar(500), row.fileRef || null)
      .input("Observacoes", sqlServer.NVarChar(500), row.notes || null)
      .query("INSERT INTO dbo.FleetDeskDocumentos (Id, TipoVinculo, RegistroId, TipoDocumento, Nome, Vencimento, ArquivoReferencia, Observacoes) VALUES (@Id, @TipoVinculo, @RegistroId, @TipoDocumento, @Nome, @Vencimento, @ArquivoReferencia, @Observacoes)");
  }
}

async function insertRelationalAuditLogs(transaction, rows) {
  for (const row of rows) {
    await new sqlServer.Request(transaction)
      .input("Id", sqlServer.NVarChar(80), row.id)
      .input("UsuarioId", sqlServer.NVarChar(80), row.userId || null)
      .input("UsuarioEmail", sqlServer.NVarChar(180), row.userEmail || null)
      .input("Acao", sqlServer.NVarChar(40), row.action)
      .input("Entidade", sqlServer.NVarChar(60), row.entity)
      .input("RegistroId", sqlServer.NVarChar(80), row.recordId || null)
      .input("Resumo", sqlServer.NVarChar(500), row.summary || "")
      .input("CriadoEm", sqlServer.DateTime, parseDbDate(row.createdAt) || new Date())
      .query("INSERT INTO dbo.FleetDeskAuditoria (Id, UsuarioId, UsuarioEmail, Acao, Entidade, RegistroId, Resumo, CriadoEm) VALUES (@Id, @UsuarioId, @UsuarioEmail, @Acao, @Entidade, @RegistroId, @Resumo, @CriadoEm)");
  }
}

async function getSqlPool() {
  if (sqlPool?.connected) return sqlPool;
  if (!sqlServer) sqlServer = require("mssql");

  sqlPool = await sqlServer.connect({
    server: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_DATABASE || "FleetDesk",
    user: process.env.DB_USER || "sa",
    password: process.env.DB_PASSWORD || "",
    options: sqlServerOptions(),
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  });

  return sqlPool;
}

async function getPostgresPool() {
  if (postgresPool) return postgresPool;
  if (!postgres) postgres = require("pg");

  const config = process.env.DB_CONNECTION_STRING || process.env.DATABASE_URL
    ? {
        connectionString: process.env.DB_CONNECTION_STRING || process.env.DATABASE_URL
      }
    : {
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_DATABASE || "postgres",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || ""
      };

  if (envBool("DB_SSL", true)) {
    config.ssl = {
      rejectUnauthorized: envBool("DB_SSL_REJECT_UNAUTHORIZED", false)
    };
  }

  postgresPool = new postgres.Pool({
    ...config,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT || 30000)
  });

  return postgresPool;
}

function sqlServerOptions() {
  const options = {
    encrypt: envBool("DB_ENCRYPT", false),
    trustServerCertificate: envBool("DB_TRUST_SERVER_CERTIFICATE", true),
    enableArithAbort: envBool("DB_ENABLE_ARITH_ABORT", false)
  };

  if (process.env.DB_TDS_VERSION) {
    options.tdsVersion = process.env.DB_TDS_VERSION;
  }

  return options;
}

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "sim", "on"].includes(String(value).toLowerCase());
}

function emptyState() {
  return Object.fromEntries(collectionNames.map((name) => [name, []]));
}

function toDateValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return date.toISOString().slice(0, 10);
}

function toDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return date.toISOString().slice(0, 16);
}

function parseDbDate(value) {
  if (!value) return null;
  return new Date(value);
}

module.exports = {
  dbInfo,
  initDb,
  readDb,
  writeDb
};
