-- ════════════════════════════════════════════════════════════
-- Deeraj Interiors CRM  –  Complete Database Schema + Data
-- ════════════════════════════════════════════════════════════

DROP DATABASE IF EXISTS deeraj_crm;
CREATE DATABASE deeraj_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE deeraj_crm;

-- ─── USERS ───────────────────────────────────────────────────
CREATE TABLE users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  username   VARCHAR(50)  NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  role       ENUM('admin','agent') DEFAULT 'agent',
  is_active  TINYINT(1)   DEFAULT 1,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ─── LEADS ───────────────────────────────────────────────────
CREATE TABLE leads (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  created_by           INT NOT NULL,
  assigned_to          INT DEFAULT NULL,

  name                 VARCHAR(150) NOT NULL,
  primary_phone        VARCHAR(20)  NOT NULL,
  alternate_phone      VARCHAR(20)  DEFAULT '',
  location             VARCHAR(200) DEFAULT '',
  project_type         VARCHAR(100) DEFAULT '',
  lead_source          VARCHAR(100) DEFAULT '',
  priority             ENUM('HIGH','MEDIUM','LOW') DEFAULT 'MEDIUM',
  status               ENUM('ACTIVE','CLOSED','CONVERTED') DEFAULT 'ACTIVE',
  highlight_color      VARCHAR(20)  DEFAULT NULL,

  -- 1st Call
  caller_name          VARCHAR(100) DEFAULT '',
  first_calling_date   DATE         DEFAULT NULL,
  call_category        ENUM('NOT INTERESTED','FOLLOW UP','NOT ATTENDING','BOOKED','CALLBACK','BUSY') DEFAULT 'FOLLOW UP',
  first_call_remark    TEXT,

  -- Quote
  quote_sent           ENUM('YES','NO','') DEFAULT '',
  quote_sent_date      DATE DEFAULT NULL,
  quote_amount         DECIMAL(12,2) DEFAULT NULL,

  -- Order
  order_booked         ENUM('YES','NO','') DEFAULT '',
  order_date           DATE DEFAULT NULL,
  order_amount         DECIMAL(12,2) DEFAULT NULL,

  -- 2nd Call
  second_caller_name   VARCHAR(100) DEFAULT '',
  second_calling_date  DATE DEFAULT NULL,
  second_call_category ENUM('NOT INTERESTED','FOLLOW UP','NOT ATTENDING','BOOKED','CALLBACK','BUSY','') DEFAULT '',
  second_call_remark   TEXT,

  -- 3rd Call
  third_caller_name    VARCHAR(100) DEFAULT '',
  third_calling_date   DATE DEFAULT NULL,
  third_call_category  ENUM('NOT INTERESTED','FOLLOW UP','NOT ATTENDING','BOOKED','CALLBACK','BUSY','') DEFAULT '',
  third_call_remark    TEXT,

  -- WhatsApp summary
  latest_whatsapp_date DATE DEFAULT NULL,
  whatsapp_category    ENUM('DECORATION','INTERIORS','RENOVATION','CONSULTATION','FOLLOW UP','') DEFAULT '',
  whatsapp_remark      TEXT,

  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)  REFERENCES users(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);

-- ─── CALL LOGS ───────────────────────────────────────────────
CREATE TABLE call_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  lead_id       INT NOT NULL,
  user_id       INT NOT NULL,
  call_number   TINYINT DEFAULT 1,
  call_date     DATE NOT NULL,
  call_category ENUM('NOT INTERESTED','FOLLOW UP','NOT ATTENDING','BOOKED','CALLBACK','BUSY') NOT NULL,
  remark        TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ─── WHATSAPP LOGS ───────────────────────────────────────────
CREATE TABLE whatsapp_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  lead_id      INT NOT NULL,
  user_id      INT NOT NULL,
  sent_date    DATE NOT NULL,
  category     ENUM('DECORATION','INTERIORS','RENOVATION','CONSULTATION','FOLLOW UP') NOT NULL,
  message_type ENUM('SENT','RECEIVED','BOTH') DEFAULT 'SENT',
  remark       TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════

-- USERS  (id=1 admin, 2=sakshi, 3=priya, 4=ravi, 5=anjali)
INSERT INTO users (id, name, username, password, role) VALUES
(1, 'Admin',      'admin',   'admin123',   'admin'),
(2, 'Sakshi',     'sakshi',  'sakshi123',  'agent'),
(3, 'Priya',      'priya',   'priya123',   'agent'),
(4, 'Ravi Kumar', 'ravi',    'ravi123',    'agent'),
(5, 'Anjali',     'anjali',  'anjali123',  'agent');

-- LEADS
INSERT INTO leads
  (created_by, assigned_to, name, primary_phone, alternate_phone, location, project_type,
   caller_name, first_calling_date, call_category, first_call_remark,
   quote_sent, order_booked,
   second_calling_date, second_call_category, second_call_remark,
   latest_whatsapp_date, whatsapp_category, whatsapp_remark,
   priority, lead_source, status)
VALUES
(2,2,'Mahesh','9963462553','','Hyderabad','3BHK','Sakshi','2024-11-30','NOT INTERESTED','no not required','','',NULL,'','','2025-01-15','DECORATION','sent brochure','LOW','Website','ACTIVE'),
(2,2,'Anil Kumar','9876543210','9876543211','Guntur','4BHK','Sakshi','2024-11-30','FOLLOW UP','if required he will call us','','',NULL,'','','2025-01-15','DECORATION','followed up','MEDIUM','Referral','ACTIVE'),
(2,3,'Venkat','9988776655','','Vijayawada','Villa','Priya','2024-11-30','NOT INTERESTED','no thank you','YES','',NULL,'','','2025-01-15','DECORATION','sent portfolio','LOW','Website','ACTIVE'),
(2,3,'Saikiran','9977665544','','Hyderabad','2BHK','Priya','2024-11-30','NOT INTERESTED','noo','','',NULL,'','','2025-01-15','DECORATION','','LOW','Walk-in','ACTIVE'),
(2,2,'Sravan Mukka','9966554433','','Hyderabad','3BHK','Sakshi','2024-11-30','NOT INTERESTED','no not interested','','',NULL,'','','2025-01-15','DECORATION','','LOW','Website','ACTIVE'),
(2,4,'Durga Sameera Puli','9955443322','','Guntur','4BHK','Ravi Kumar','2024-11-30','NOT INTERESTED','she wants designs sent','YES','',NULL,'','','2025-01-15','DECORATION','sent 4BHK designs','MEDIUM','Referral','ACTIVE'),
(2,4,'Sri Kumar','9944332211','','Hyderabad','Office','Ravi Kumar','2024-11-30','NOT INTERESTED','no not required','','',NULL,'','',NULL,'','','LOW','Website','ACTIVE'),
(2,2,'Goutham Sreevani','9933221100','','Hyderabad','3BHK','Sakshi','2024-11-30','NOT ATTENDING','','','','2024-08-23','FOLLOW UP','will check and call','2025-01-15','DECORATION','sent message','MEDIUM','Website','ACTIVE'),
(2,5,'Shivani Reddy','9922110099','9123456789','Vijayawada','4BHK','Anjali','2024-11-30','NOT ATTENDING','','YES','','2024-08-23','FOLLOW UP','interested in interiors','2025-01-15','INTERIORS','sent catalog','HIGH','Referral','ACTIVE'),
(2,5,'Hanumanulu Tamlurka','9911009988','','Hyderabad','Villa','Anjali','2024-11-30','NOT INTERESTED','no not required','','','2024-08-23','NOT INTERESTED','confirmed not required','2025-01-15','DECORATION','','LOW','Website','CLOSED'),
(2,2,'Prabhakar Reddy','9900998877','','Hyderabad','2BHK','Sakshi','2024-11-30','NOT INTERESTED','not required','','',NULL,'','','2025-01-15','DECORATION','','LOW','Walk-in','ACTIVE'),
(2,3,'Ravi S','9891234567','','Guntur','3BHK','Priya','2024-11-30','NOT INTERESTED','noo','','',NULL,'','','2025-01-15','DECORATION','','LOW','Website','ACTIVE'),
(2,2,'Anjali CS','9881234567','','Hyderabad','4BHK','Sakshi','2024-11-30','NOT INTERESTED','no thank you','','',NULL,'','','2025-01-15','DECORATION','','LOW','Referral','ACTIVE'),
(2,4,'Santosh Kumar','9871234567','','Hyderabad','Office','Ravi Kumar','2024-11-30','NOT INTERESTED','not required','','','2024-08-23','NOT INTERESTED','no budget','2025-01-15','INTERIORS','','LOW','Website','CLOSED'),
(2,5,'Vijay Kumar','9861234567','','Vijayawada','3BHK','Anjali','2024-11-30','NOT INTERESTED','no requirements','','',NULL,'','','2025-01-15','DECORATION','','LOW','Website','ACTIVE'),
(2,2,'Saritha','9851234567','9988776655','Hyderabad','4BHK','Sakshi','2024-11-30','FOLLOW UP','interested will confirm','YES','YES',NULL,'','','2025-01-15','DECORATION','deal confirmed','HIGH','Referral','CONVERTED'),
(2,3,'Venkat B','9841234567','','Hyderabad','3BHK','Priya','2024-11-30','FOLLOW UP','if required they will call us','','',NULL,'','','2025-01-15','DECORATION','','MEDIUM','Website','ACTIVE'),
(2,4,'Deepika','9831234567','','Hyderabad','4BHK','Ravi Kumar','2024-11-30','CALLBACK','will call back tomorrow','YES','','2024-12-05','FOLLOW UP','confirmed meeting','2025-01-20','INTERIORS','sent design options','HIGH','Instagram','ACTIVE'),
(2,5,'Ramesh','9821234567','','Vijayawada','Villa','Anjali','2024-11-30','FOLLOW UP','very interested','YES','YES','2024-12-10','BOOKED','order confirmed','2025-01-22','RENOVATION','sent renovation plan','HIGH','Google','CONVERTED'),
(2,2,'Lakshmi','9811234567','','Hyderabad','2BHK','Sakshi','2024-11-30','NOT ATTENDING','','','',NULL,'','','2025-01-15','DECORATION','','MEDIUM','Facebook','ACTIVE');

-- CALL LOGS
INSERT INTO call_logs (lead_id, user_id, call_number, call_date, call_category, remark) VALUES
(1,  2, 1, '2024-11-30', 'NOT INTERESTED', 'Customer said not required at the moment'),
(2,  2, 1, '2024-11-30', 'FOLLOW UP',      'Customer asked us to call back later'),
(3,  3, 1, '2024-11-30', 'NOT INTERESTED', 'No thank you - not looking for interiors now'),
(8,  2, 1, '2024-11-30', 'NOT ATTENDING',  'Call not picked up'),
(8,  2, 2, '2024-08-23', 'FOLLOW UP',      'Customer picked, will check and call back'),
(9,  5, 1, '2024-11-30', 'NOT ATTENDING',  'No answer on first call'),
(9,  5, 2, '2024-08-23', 'FOLLOW UP',      'Interested in interiors, needs quote'),
(16, 2, 1, '2024-11-30', 'FOLLOW UP',      'Very interested, will confirm next week'),
(18, 4, 1, '2024-11-30', 'CALLBACK',       'Customer busy, asked to call tomorrow'),
(18, 4, 2, '2024-12-05', 'FOLLOW UP',      'Confirmed interest - wants meeting'),
(19, 5, 1, '2024-11-30', 'FOLLOW UP',      'Very interested in Villa renovation'),
(19, 5, 2, '2024-12-10', 'BOOKED',         'Order confirmed for full villa');

-- WHATSAPP LOGS
INSERT INTO whatsapp_logs (lead_id, user_id, sent_date, category, message_type, remark) VALUES
(1,  2, '2025-01-15', 'DECORATION',   'SENT',     'Sent company brochure and portfolio'),
(2,  2, '2025-01-15', 'DECORATION',   'SENT',     'Followed up on WhatsApp, no reply yet'),
(3,  3, '2025-01-15', 'DECORATION',   'SENT',     'Sent portfolio link and pricing'),
(6,  4, '2025-01-15', 'DECORATION',   'SENT',     'Sent 4BHK design options and quotation'),
(8,  2, '2025-01-15', 'DECORATION',   'BOTH',     'Sent message, got reply - will think about it'),
(9,  5, '2025-01-15', 'INTERIORS',    'SENT',     'Sent full interior catalog PDF'),
(16, 2, '2025-01-15', 'DECORATION',   'RECEIVED', 'Customer replied - confirmed they want to proceed'),
(18, 4, '2025-01-20', 'INTERIORS',    'BOTH',     'Sent design options, customer liked option 2'),
(19, 5, '2025-01-22', 'RENOVATION',   'BOTH',     'Sent renovation plan, customer approved and paid advance');

-- ─── SERVICE CALLS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_calls (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  created_by  INT NOT NULL,
  name        VARCHAR(150) NOT NULL,
  phone       VARCHAR(20)  NOT NULL,
  department  VARCHAR(100) NOT NULL,
  description TEXT         DEFAULT '',
  status      ENUM('Open','In Progress','Resolved') DEFAULT 'Open',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
