-- init.sql - sets up decoy + honeytoken logging

-- decoy schema & table
CREATE SCHEMA IF NOT EXISTS decoy;

CREATE TABLE IF NOT EXISTS decoy.sensitive_backup (
    id          serial PRIMARY KEY,
    full_name   text,
    ssn_dummy   text,
    salary_dummy numeric,
    created_at  timestamptz DEFAULT now()
);

-- seed one decoy row
INSERT INTO decoy.sensitive_backup(full_name, ssn_dummy, salary_dummy)
VALUES ('Janet Decoy', '000-00-0000', 99999.99);

-- security schema & alerts table
CREATE SCHEMA IF NOT EXISTS security;

CREATE TABLE IF NOT EXISTS security.honey_alerts (
    alert_id    serial PRIMARY KEY,
    actor       text,
    client_ip   text,
    resource    text,
    action      text,
    details     jsonb,
    event_ts    timestamptz DEFAULT now()
);



-- function to log an INSERT into alerts table
CREATE OR REPLACE FUNCTION security.log_decoy_write()
RETURNS trigger AS $$
BEGIN
  INSERT INTO security.honey_alerts(actor, client_ip, resource, action, details)
  VALUES (
    current_user,
    inet_client_addr()::text,
    'decoy.sensitive_backup',
    TG_OP,
    jsonb_build_object(
      'row_id', NEW.id,
      'full_name', NEW.full_name,
      'ssn_dummy', NEW.ssn_dummy,
      'salary_dummy', NEW.salary_dummy
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------
-- Realistic employee table with embedded honeytoken rows
-- -------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS prod;

CREATE TABLE IF NOT EXISTS prod.employee_directory (
    employee_id   integer PRIMARY KEY,
    full_name     text NOT NULL,
    department    text NOT NULL,
    title         text NOT NULL,
    office_city   text NOT NULL,
    salary        numeric NOT NULL,
    work_email    text NOT NULL,
    hired_date    date NOT NULL,
    is_honeytoken boolean NOT NULL DEFAULT false
);

-- Normal data rows
INSERT INTO prod.employee_directory
    (employee_id, full_name, department, title, office_city, salary, work_email, hired_date, is_honeytoken)
VALUES
    (1001, 'Benjamin Rader', 'Computer Science', 'Software Engineer', 'Knoxville', 42000, 'rvf434@mocs.utc.edu', '2021-05-17', false),
    (1002, 'Boris Speed', 'Computer Science', 'Accountant', 'Nashville', 72000, 'hkc279@mocs.utc.edu', '2020-09-01', false),
    (1003, 'Alex Johnson', 'HR', 'HR Generalist', 'Nashville', 65000, 'alex.johnson@example.com', '2019-03-22', false),
    (1004, 'Morgan Lee', 'Sales', 'Account Manager', 'Memphis', 78000, 'morgan.lee@example.com', '2022-01-10', false);

-- Honeytoken rows
INSERT INTO prod.employee_directory
    (employee_id, full_name, department, title, office_city, salary, work_email, hired_date, is_honeytoken)
VALUES
    (999001, 'System Audit User', 'Finance', 'Executive Oversight', 'Unknown', 999999.99,
     'audit-user+finsec@example.com', '2010-01-01', true),
    (999002, 'Internal Controls Officer', 'Executive', 'Chief Data Protection Officer', 'Knoxville', 350000,
     'cdpo-internal@example.com', '2018-06-30', true),
    (999003, 'Backup Payroll Mirror', 'Payroll', 'Payroll Specialist', 'Knoxville', 89000,
     'payroll-backup@example.net', '2023-04-01', true);

-- -------------------------------------------------------------------
-- Trigger: log ANY access to honeytoken employee entries
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION security.log_employee_honeytoken()
RETURNS trigger AS $$
DECLARE
    actor_text text := current_user;
BEGIN
    IF NEW.is_honeytoken THEN
        INSERT INTO security.honey_alerts(actor, client_ip, resource, action, details)
        VALUES (
            actor_text,
            inet_client_addr()::text,
            'prod.employee_directory',
            TG_OP,
            jsonb_build_object('employee_id', NEW.employee_id, 'full_name', NEW.full_name)
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employee_honeytoken ON prod.employee_directory;

CREATE TRIGGER trg_employee_honeytoken
AFTER SELECT OR INSERT OR UPDATE OR DELETE
ON prod.employee_directory
FOR EACH ROW
EXECUTE FUNCTION security.log_employee_honeytoken();


DROP TRIGGER IF EXISTS trg_log_decoy_write ON decoy.sensitive_backup;

CREATE TRIGGER trg_log_decoy_write
AFTER INSERT ON decoy.sensitive_backup
FOR EACH ROW EXECUTE FUNCTION security.log_decoy_write();
