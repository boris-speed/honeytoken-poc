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
VALUES ('Janet Decoy', '123-45-6000', 99999.99);

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

-- security schema alert trigger funtion + INSERT into alerts table
CREATE OR REPLACE FUNCTION security.log_decoy_write()
RETURNS trigger AS $$
BEGIN
  INSERT INTO security.honey_alerts(actor, client_ip, resource, action, details)
  VALUES (
    current_user, -- attacker DB user (either compromised or created)
    inet_client_addr()::text, -- attacker IP address
    'decoy.sensitive_backup', -- resource accessed
    TG_OP, -- operation type
    jsonb_build_object( -- details about the decoy row accessed
      'row_id', NEW.id,
      'full_name', NEW.full_name,
      'ssn_dummy', NEW.ssn_dummy,
      'salary_dummy', NEW.salary_dummy
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_decoy_write ON decoy.sensitive_backup;

CREATE TRIGGER trg_log_decoy_write
AFTER INSERT OR SELECT OR UPDATE OR DELETE ON decoy.sensitive_backup
FOR EACH ROW EXECUTE FUNCTION security.log_decoy_write();