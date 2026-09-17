CREATE TABLE IF NOT EXISTS voter_enrollments (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  institutional_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at DATETIME(3) NOT NULL,
  activated_at DATETIME(3) NULL,
  CONSTRAINT voter_enrollment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT voter_institutional_id_unique UNIQUE (institutional_id),
  CONSTRAINT voter_activation_token_unique UNIQUE (token_hash)
) ENGINE=InnoDB;
