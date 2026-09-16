ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'voter', 'candidate', 'auditor', 'party') NOT NULL DEFAULT 'voter';
