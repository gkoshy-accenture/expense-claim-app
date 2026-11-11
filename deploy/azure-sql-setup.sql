-- Run ONCE in the Azure portal Query editor, connected to the database (expense-claims-db)
-- as the server admin (sql-admin). Replace both passwords first. Do not commit real passwords.
-- Tip: letters and digits only keeps the VM's env files free of quoting problems.

IF OBJECT_ID('dbo.claims') IS NULL
CREATE TABLE dbo.claims (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  employee    NVARCHAR(80)  NOT NULL,
  category    NVARCHAR(30)  NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  description NVARCHAR(200) NOT NULL,
  status      NVARCHAR(20)  NOT NULL DEFAULT 'Submitted',
  created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Sample data (skip this block if you want an empty table)
INSERT INTO dbo.claims (employee, category, amount, description, status) VALUES
 ('Maya Chen',  'Travel',   184.20, 'Train to client workshop',        'Approved'),
 ('Tom Becker', 'Software',  49.00, 'Monthly design tool licence',     'Submitted'),
 ('Priya Nair', 'Meals',     36.75, 'Team lunch during sprint review', 'Submitted');

-- The app reads and writes claims. It cannot create or drop tables.
CREATE USER app_user WITH PASSWORD = 'REPLACE-WITH-STRONG-PASSWORD-1';
ALTER ROLE db_datareader ADD MEMBER app_user;
ALTER ROLE db_datawriter ADD MEMBER app_user;

-- The MCP server can only read.
CREATE USER mcp_reader WITH PASSWORD = 'REPLACE-WITH-STRONG-PASSWORD-2';
ALTER ROLE db_datareader ADD MEMBER mcp_reader;
