-- Stage E3 chooses approach (a): keep roles as ordered TEXT values with an
-- explicit CHECK enum because the API and admin UI already exchange readable
-- role names, while role_rank gives the server a stable integer comparison
-- column for hierarchy checks and future per-resource permissions.

PRAGMA foreign_keys=OFF;

BEGIN;

CREATE TABLE users_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('guest', 'student', 'reviewer', 'educator', 'admin')) DEFAULT 'student',
    role_rank INTEGER GENERATED ALWAYS AS (
        CASE role
            WHEN 'guest' THEN 0
            WHEN 'student' THEN 1
            WHEN 'reviewer' THEN 2
            WHEN 'educator' THEN 3
            WHEN 'admin' THEN 4
        END
    ) STORED,
    department TEXT,
    status TEXT CHECK(status IN ('active', 'inactive', 'suspended')) DEFAULT 'active',
    last_login DATETIME,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    institution TEXT,
    address TEXT,
    phone TEXT,
    alternative_email TEXT,
    education TEXT,
    grade TEXT
);

INSERT INTO users_new (
    id, username, name, password_hash, email, role, department, status,
    last_login, failed_login_attempts, locked_until, created_at, updated_at,
    deleted_at, institution, address, phone, alternative_email, education, grade
)
SELECT
    id,
    username,
    name,
    password_hash,
    email,
    CASE
        WHEN role = 'admin' THEN 'admin'
        WHEN role IN ('reviewer', 'educator', 'guest', 'student') THEN role
        ELSE 'student'
    END,
    department,
    status,
    last_login,
    failed_login_attempts,
    locked_until,
    created_at,
    updated_at,
    deleted_at,
    institution,
    address,
    phone,
    alternative_email,
    education,
    grade
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_role_rank ON users(role_rank);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

COMMIT;

PRAGMA foreign_keys=ON;
