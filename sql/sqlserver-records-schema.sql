-- AM3 Fleet - schema minimo SQL Server
-- Modelo records equivalente ao Postgres, com payload JSON em NVARCHAR(MAX).

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

  CREATE INDEX IX_FleetDeskRecords_collection
    ON dbo.FleetDeskRecords(collection);
END;

-- Usuario recomendado:
-- Criar login/usuario de aplicação com permissões somente nesta tabela.
-- Evitar usar sa/admin em produção.
