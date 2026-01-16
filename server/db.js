import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlite = sqlite3.verbose();

// Connect to SQLite database
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

// Seed default agent personas
function seedDefaultAgents() {
    const defaultAgents = [
        {
            agent_type: 'nurse',
            name: 'Sarah Mitchell',
            role_title: 'Bedside Nurse',
            system_prompt: `You are Sarah Mitchell, an experienced bedside nurse with 8 years of experience in acute care. You are professional, attentive, and supportive.

Your role:
- You assist the medical student/resident with patient care tasks
- You can provide vital signs, help with positioning, and assist with procedures
- You alert the team to changes in patient status
- You have knowledge of medications, dosing, and administration
- You follow orders but will speak up if something seems unsafe

Communication style:
- Clear and professional
- Use nursing terminology appropriately
- Be helpful but don't do the doctor's job for them
- Ask clarifying questions when orders are unclear
- Report observations factually

You have access to the patient's current vitals, recent events, and can see what has been ordered. Base your responses on actual patient data when available.`,
            context_filter: 'full',
            communication_style: 'professional',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'present',
                can_be_paged: false,
                response_time: { min: 0, max: 0 }
            })
        },
        {
            agent_type: 'consultant',
            name: 'Dr. James Chen',
            role_title: 'Senior Consultant',
            system_prompt: `You are Dr. James Chen, a senior consultant physician with 20 years of experience. You are knowledgeable, thorough, and educational in your approach.

Your role:
- You provide expert consultation when called
- You review the case, examine findings, and offer diagnostic and treatment recommendations
- You teach and guide junior doctors through complex decisions
- You may ask Socratic questions to help learners think through problems

Communication style:
- Thoughtful and measured
- Use appropriate medical terminology
- Explain your reasoning and differential diagnosis
- Ask about relevant history and examination findings
- Offer evidence-based recommendations

When consulted:
- Review the patient's current state and recent events
- Ask clarifying questions about the presentation
- Provide structured recommendations
- Suggest further workup if needed
- Be willing to discuss your reasoning

You have access to the patient's full record. Base your assessment on the actual clinical data available.`,
            context_filter: 'full',
            communication_style: 'educational',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'on-call',
                can_be_paged: true,
                response_time: { min: 2, max: 5 }
            })
        },
        {
            agent_type: 'relative',
            name: 'Family Member',
            role_title: 'Patient\'s Relative',
            system_prompt: `You are a close family member of the patient. You are concerned, emotional, and want the best for your loved one.

Your role:
- You can provide additional history about the patient
- You may know details about medications, allergies, or past medical events
- You express worry and need reassurance
- You ask questions about what is happening and the plan
- You may need things explained in simple terms

Communication style:
- Emotional and concerned
- Use lay terms, not medical jargon
- Ask for explanations when you don't understand
- Express gratitude when given attention
- May become anxious or upset if ignored

Important behaviors:
- You know the patient's daily life, habits, and recent symptoms before admission
- You can clarify medication names or allergies if asked
- You want to be kept informed about the plan
- You may ask "Is my [family member] going to be okay?"
- You appreciate when doctors take time to explain

Respond based on the patient information available. If specific family relationship isn't defined, you can be a spouse, adult child, or sibling as appropriate.`,
            context_filter: 'history',
            communication_style: 'emotional',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'present',
                can_be_paged: false,
                response_time: { min: 0, max: 0 }
            })
        }
    ];

    // Insert default agents if they don't exist
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO agent_templates
        (agent_type, name, role_title, system_prompt, context_filter, communication_style, is_default, config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    defaultAgents.forEach(agent => {
        stmt.run(
            agent.agent_type,
            agent.name,
            agent.role_title,
            agent.system_prompt,
            agent.context_filter,
            agent.communication_style,
            agent.is_default,
            agent.config
        );
    });

    stmt.finalize(() => {
        console.log('Default agent personas seeded.');
    });
}

function initDb() {
    db.serialize(() => {
    // 1. Users Table - Enhanced with audit fields
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        name TEXT,
        password_hash TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
        department TEXT,
        status TEXT CHECK(status IN ('active', 'inactive', 'suspended')) DEFAULT 'active',
        last_login DATETIME,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
    )`);

        // 2. Cases Table - Enhanced with patient info and audit fields
        db.run(`CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            system_prompt TEXT,
            config JSON,
            image_url TEXT,
            patient_name TEXT,
            patient_gender TEXT CHECK(patient_gender IN ('Male', 'Female', 'Other')),
            patient_age INTEGER,
            chief_complaint TEXT,
            difficulty_level TEXT CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced')),
            estimated_duration_minutes INTEGER,
            learning_objectives JSON,
            version INTEGER DEFAULT 1,
            is_available BOOLEAN DEFAULT 0,
            is_default BOOLEAN DEFAULT 0,
            is_published BOOLEAN DEFAULT 0,
            published_at DATETIME,
            scenario JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            last_modified_by INTEGER,
            deleted_at DATETIME,
            FOREIGN KEY(created_by) REFERENCES users(id),
            FOREIGN KEY(last_modified_by) REFERENCES users(id)
        )`);

        // Migration Check: Add image_url if it doesn't exist
        db.all("PRAGMA table_info(cases)", (err, rows) => {
            if (rows && !rows.find(r => r.name === 'image_url')) {
                db.run("ALTER TABLE cases ADD COLUMN image_url TEXT");
            }
        });

        // 3. Sessions Table - Enhanced with status and performance tracking
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER,
            user_id INTEGER,
            student_name TEXT,
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            end_time DATETIME,
            duration INTEGER,
            status TEXT CHECK(status IN ('active', 'paused', 'completed', 'abandoned')) DEFAULT 'active',
            case_version INTEGER,
            exam_findings_count INTEGER DEFAULT 0,
            investigation_count INTEGER DEFAULT 0,
            message_count INTEGER DEFAULT 0,
            performance_score REAL,
            instructor_notes TEXT,
            monitor_settings JSON,
            llm_settings JSON,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted_at DATETIME,
            FOREIGN KEY(case_id) REFERENCES cases(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

    // Migration Check: Add user_id, end_time, duration to sessions if they don't exist
    db.all("PRAGMA table_info(sessions)", (err, rows) => {
        if (rows) {
            if (!rows.find(r => r.name === 'user_id')) {
                db.run("ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id)");
            }
            if (!rows.find(r => r.name === 'end_time')) {
                db.run("ALTER TABLE sessions ADD COLUMN end_time DATETIME");
            }
            if (!rows.find(r => r.name === 'duration')) {
                db.run("ALTER TABLE sessions ADD COLUMN duration INTEGER");
            }
        }
    });

    // Migration Check: Add name to users if it doesn't exist
    db.all("PRAGMA table_info(users)", (err, rows) => {
        if (rows && !rows.find(r => r.name === 'name')) {
            db.run("ALTER TABLE users ADD COLUMN name TEXT", (err) => {
                if (err) console.error("Error adding name column:", err);
                else console.log("Added 'name' column to users table");
            });
        }
    });

        // 4. Interactions Table (Chat Logs)
        db.run(`CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            role TEXT CHECK(role IN ('user', 'assistant', 'system')),
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )`);

        // 5. Login Logs Table - Track all login/logout events
        db.run(`CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT CHECK(action IN ('login', 'logout', 'failed_login')) NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 6. Settings Logs Table - Track all settings changes
        db.run(`CREATE TABLE IF NOT EXISTS settings_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id INTEGER,
            case_id INTEGER,
            setting_type TEXT CHECK(setting_type IN ('llm', 'monitor', 'case_load')) NOT NULL,
            setting_name TEXT,
            old_value TEXT,
            new_value TEXT,
            settings_json JSON,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(case_id) REFERENCES cases(id)
        )`);

        // 7. Session Settings Table - Link settings to sessions
        db.run(`CREATE TABLE IF NOT EXISTS session_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            case_id INTEGER,
            user_id INTEGER,
            llm_provider TEXT,
            llm_model TEXT,
            llm_base_url TEXT,
            monitor_hr INTEGER,
            monitor_rhythm TEXT,
            monitor_spo2 INTEGER,
            monitor_bp_sys INTEGER,
            monitor_bp_dia INTEGER,
            monitor_rr INTEGER,
            monitor_temp REAL,
            settings_snapshot JSON,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(case_id) REFERENCES cases(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Migration: Add monitor_settings to sessions table
        db.all("PRAGMA table_info(sessions)", (err, rows) => {
            if (rows && !rows.find(r => r.name === 'monitor_settings')) {
                db.run("ALTER TABLE sessions ADD COLUMN monitor_settings JSON");
            }
            if (rows && !rows.find(r => r.name === 'llm_settings')) {
                db.run("ALTER TABLE sessions ADD COLUMN llm_settings JSON");
            }
        });

        // 8. Event Log Table - Chronological event tracking
        db.run(`CREATE TABLE IF NOT EXISTS event_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            event_type TEXT,
            description TEXT,
            vital_sign TEXT,
            old_value TEXT,
            new_value TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )`);

        // 9. Alarm Events Table - Track alarm triggers and acknowledgments
        db.run(`CREATE TABLE IF NOT EXISTS alarm_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            vital_sign TEXT,
            threshold_type TEXT,
            threshold_value REAL,
            actual_value REAL,
            triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            acknowledged_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )`);

        // 10. Alarm Config Table - User-specific alarm thresholds
        db.run(`CREATE TABLE IF NOT EXISTS alarm_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            vital_sign TEXT,
            high_threshold REAL,
            low_threshold REAL,
            enabled BOOLEAN DEFAULT 1,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 11. Case Investigations Table - Labs/Radiology per case
        db.run(`CREATE TABLE IF NOT EXISTS case_investigations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER,
            investigation_type TEXT,
            test_name TEXT,
            result_data JSON,
            image_url TEXT,
            turnaround_minutes INTEGER DEFAULT 30,
            FOREIGN KEY(case_id) REFERENCES cases(id)
        )`);

        // Migration: Add lab database columns to case_investigations
        db.all("PRAGMA table_info(case_investigations)", (err, rows) => {
            if (rows) {
                if (!rows.find(r => r.name === 'test_group')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN test_group TEXT");
                }
                if (!rows.find(r => r.name === 'gender_category')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN gender_category TEXT");
                }
                if (!rows.find(r => r.name === 'min_value')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN min_value REAL");
                }
                if (!rows.find(r => r.name === 'max_value')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN max_value REAL");
                }
                if (!rows.find(r => r.name === 'current_value')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN current_value REAL");
                }
                if (!rows.find(r => r.name === 'unit')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN unit TEXT");
                }
                if (!rows.find(r => r.name === 'normal_samples')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN normal_samples JSON");
                }
                if (!rows.find(r => r.name === 'is_abnormal')) {
                    db.run("ALTER TABLE case_investigations ADD COLUMN is_abnormal BOOLEAN DEFAULT 0");
                }
            }
        });

        // 12. Investigation Orders Table - Track ordered tests
        db.run(`CREATE TABLE IF NOT EXISTS investigation_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            investigation_id INTEGER,
            ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            available_at DATETIME,
            viewed_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(investigation_id) REFERENCES case_investigations(id)
        )`);

        // Migration: Add scenario column to cases table
        db.all("PRAGMA table_info(cases)", (err, rows) => {
            if (rows && !rows.find(r => r.name === 'scenario')) {
                db.run("ALTER TABLE cases ADD COLUMN scenario JSON");
            }
            // Migration: Add is_available and is_default columns for student access control
            if (rows && !rows.find(r => r.name === 'is_available')) {
                db.run("ALTER TABLE cases ADD COLUMN is_available BOOLEAN DEFAULT 0", (err) => {
                    if (!err) console.log("Added 'is_available' column to cases table");
                });
            }
            if (rows && !rows.find(r => r.name === 'is_default')) {
                db.run("ALTER TABLE cases ADD COLUMN is_default BOOLEAN DEFAULT 0", (err) => {
                    if (!err) console.log("Added 'is_default' column to cases table");
                });
            }
        });

        // 14. Platform Settings Table - Admin configuration
        db.run(`CREATE TABLE IF NOT EXISTS platform_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT,
            updated_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(updated_by) REFERENCES users(id)
        )`);

        // 13. Scenarios Repository Table - Reusable scenario templates
        db.run(`CREATE TABLE IF NOT EXISTS scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            duration_minutes INTEGER NOT NULL,
            category TEXT,
            timeline JSON NOT NULL,
            created_by INTEGER,
            is_public BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        )`);

        // Learning Analytics Events Table - Comprehensive interaction tracking
        db.run(`CREATE TABLE IF NOT EXISTS learning_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            user_id INTEGER,
            case_id INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,

            -- xAPI-style action verbs
            verb TEXT NOT NULL,

            -- Object being acted upon
            object_type TEXT NOT NULL,
            object_id TEXT,
            object_name TEXT,

            -- Context
            component TEXT,
            parent_component TEXT,

            -- Result/Details
            result TEXT,
            duration_ms INTEGER,

            -- Additional context as JSON
            context JSON,

            -- Chat content (when verb is SENT_MESSAGE or RECEIVED_MESSAGE)
            message_content TEXT,
            message_role TEXT,

            -- Severity and category for filtering
            severity TEXT CHECK(severity IN ('DEBUG', 'INFO', 'ACTION', 'IMPORTANT', 'CRITICAL')),
            category TEXT CHECK(category IN ('SESSION', 'NAVIGATION', 'CLINICAL', 'COMMUNICATION', 'MONITORING', 'CONFIGURATION', 'ASSESSMENT', 'ERROR')),

            -- Foreign keys
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(case_id) REFERENCES cases(id)
        )`);

        // ============================================
        // NEW TABLES - State of the Art Schema
        // ============================================

        // 15. Physical Exam Findings Table - Persist all examination findings
        db.run(`CREATE TABLE IF NOT EXISTS physical_exam_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            case_id INTEGER NOT NULL,
            user_id INTEGER,
            body_region TEXT NOT NULL,
            exam_type TEXT NOT NULL,
            finding TEXT NOT NULL,
            is_abnormal BOOLEAN DEFAULT 0,
            audio_url TEXT,
            audio_played BOOLEAN DEFAULT 0,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 16. Patient Information Table - Normalized patient demographics
        db.run(`CREATE TABLE IF NOT EXISTS patient_information (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL UNIQUE,
            first_name TEXT,
            last_name TEXT,
            date_of_birth DATE,
            gender TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
            blood_type TEXT,
            weight_kg REAL,
            height_cm REAL,
            chief_complaint TEXT,
            history_of_present_illness TEXT,
            past_medical_history TEXT,
            surgical_history TEXT,
            medications_list JSON,
            allergies JSON,
            social_history TEXT,
            family_history TEXT,
            review_of_systems JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
        )`);

        // 17. Case Versions Table - Full audit trail of case changes
        db.run(`CREATE TABLE IF NOT EXISTS case_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL,
            version_number INTEGER NOT NULL,
            changed_by INTEGER NOT NULL,
            change_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            change_type TEXT CHECK(change_type IN ('created', 'updated', 'restored', 'published', 'unpublished')),
            changes_description TEXT,
            config_snapshot JSON NOT NULL,
            previous_version_id INTEGER,
            UNIQUE(case_id, version_number),
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(changed_by) REFERENCES users(id),
            FOREIGN KEY(previous_version_id) REFERENCES case_versions(id)
        )`);

        // 18. System Audit Log Table - Comprehensive audit trail
        db.run(`CREATE TABLE IF NOT EXISTS system_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER,
            username TEXT,
            action TEXT NOT NULL,
            resource_type TEXT,
            resource_id TEXT,
            resource_name TEXT,
            old_value TEXT,
            new_value TEXT,
            ip_address TEXT,
            user_agent TEXT,
            session_id INTEGER,
            status TEXT CHECK(status IN ('success', 'failure', 'warning')) DEFAULT 'success',
            error_message TEXT,
            metadata JSON,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 19. Lab Definitions Table - Master list of lab tests
        db.run(`CREATE TABLE IF NOT EXISTS lab_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_name TEXT NOT NULL,
            test_group TEXT NOT NULL,
            category TEXT CHECK(category IN ('Male', 'Female', 'Both')) DEFAULT 'Both',
            min_value REAL NOT NULL,
            max_value REAL NOT NULL,
            unit TEXT NOT NULL,
            normal_samples JSON,
            description TEXT,
            clinical_significance TEXT,
            turnaround_minutes INTEGER DEFAULT 30,
            cost REAL,
            version INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(test_name, category),
            FOREIGN KEY(created_by) REFERENCES users(id)
        )`);

        // 20. Vital Sign History Table - Track vital sign changes over time
        db.run(`CREATE TABLE IF NOT EXISTS vital_sign_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            vital_sign TEXT NOT NULL,
            value REAL NOT NULL,
            unit TEXT,
            is_alarm_triggered BOOLEAN DEFAULT 0,
            alarm_type TEXT,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            source TEXT DEFAULT 'system',
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )`);

        // 21. Export Records Table - Track all data exports
        db.run(`CREATE TABLE IF NOT EXISTS export_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            export_type TEXT NOT NULL,
            export_format TEXT,
            resource_type TEXT,
            resource_ids JSON,
            record_count INTEGER,
            file_name TEXT,
            file_size_bytes INTEGER,
            file_hash TEXT,
            exported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            filters_applied JSON,
            notes TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 22. Active Sessions Table - Track currently logged-in users
        db.run(`CREATE TABLE IF NOT EXISTS active_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id INTEGER,
            token_hash TEXT UNIQUE,
            login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            ip_address TEXT,
            user_agent TEXT,
            is_active BOOLEAN DEFAULT 1,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )`);

        // 23. Scenario Events Table - Track scenario timeline execution
        db.run(`CREATE TABLE IF NOT EXISTS scenario_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL,
            session_id INTEGER,
            event_type TEXT NOT NULL,
            event_name TEXT,
            scheduled_minutes INTEGER,
            vital_changes JSON,
            message TEXT,
            is_triggered BOOLEAN DEFAULT 0,
            triggered_at DATETIME,
            acknowledged_at DATETIME,
            acknowledged_by INTEGER,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(acknowledged_by) REFERENCES users(id)
        )`);

        // 24. User Preferences Table - Store user-specific settings
        db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            theme TEXT DEFAULT 'dark',
            language TEXT DEFAULT 'en',
            notification_settings JSON,
            dashboard_layout JSON,
            default_llm_settings JSON,
            default_monitor_settings JSON,
            accessibility_settings JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // 25. Clinical Notes Table - Store notes during sessions
        db.run(`CREATE TABLE IF NOT EXISTS clinical_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            note_type TEXT CHECK(note_type IN ('subjective', 'objective', 'assessment', 'plan', 'general')) DEFAULT 'general',
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // ============================================
        // MASTER DATA TABLES - Reference Data
        // ============================================

        // 26. Exam Techniques Table - Physical examination techniques
        db.run(`CREATE TABLE IF NOT EXISTS exam_techniques (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            technique_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            icon TEXT,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 27. Body Regions Table - Anatomical body regions
        db.run(`CREATE TABLE IF NOT EXISTS body_regions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            anatomical_view TEXT CHECK(anatomical_view IN ('anterior', 'posterior', 'both', 'special')) DEFAULT 'both',
            description TEXT,
            parent_region_id INTEGER,
            display_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(parent_region_id) REFERENCES body_regions(id)
        )`);

        // 28. Region Exam Types - Links regions to available exam techniques
        db.run(`CREATE TABLE IF NOT EXISTS region_exam_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            technique_id INTEGER NOT NULL,
            is_primary BOOLEAN DEFAULT 0,
            UNIQUE(region_id, technique_id),
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE,
            FOREIGN KEY(technique_id) REFERENCES exam_techniques(id) ON DELETE CASCADE
        )`);

        // 29. Region Special Tests - Special tests available per region
        db.run(`CREATE TABLE IF NOT EXISTS region_special_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            test_name TEXT NOT NULL,
            description TEXT,
            technique TEXT,
            positive_finding TEXT,
            negative_finding TEXT,
            clinical_significance TEXT,
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE
        )`);

        // 30. Region Default Findings - Default examination findings per region/technique
        db.run(`CREATE TABLE IF NOT EXISTS region_default_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            technique_id INTEGER NOT NULL,
            finding_text TEXT NOT NULL,
            is_normal BOOLEAN DEFAULT 1,
            UNIQUE(region_id, technique_id),
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE,
            FOREIGN KEY(technique_id) REFERENCES exam_techniques(id) ON DELETE CASCADE
        )`);

        // 31. Body Map Coordinates - Polygon coordinates for interactive body map
        db.run(`CREATE TABLE IF NOT EXISTS body_map_coordinates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            gender TEXT CHECK(gender IN ('male', 'female', 'unisex')) DEFAULT 'unisex',
            view TEXT CHECK(view IN ('anterior', 'posterior')) NOT NULL,
            polygon_points JSON NOT NULL,
            color_code TEXT,
            hover_color TEXT,
            selected_color TEXT,
            is_clickable BOOLEAN DEFAULT 1,
            z_index INTEGER DEFAULT 0,
            UNIQUE(region_id, gender, view),
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE
        )`);

        // 32. Scenario Templates Table - Pre-built clinical scenarios
        db.run(`CREATE TABLE IF NOT EXISTS scenario_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            duration_minutes INTEGER NOT NULL,
            difficulty_level TEXT CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced')),
            clinical_condition TEXT,
            learning_objectives JSON,
            is_public BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        )`);

        // 33. Scenario Timeline Points - Individual points in scenario timeline
        db.run(`CREATE TABLE IF NOT EXISTS scenario_timeline_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id INTEGER NOT NULL,
            sequence_order INTEGER NOT NULL,
            time_minutes INTEGER NOT NULL,
            label TEXT,
            description TEXT,
            hr INTEGER,
            spo2 INTEGER,
            rr INTEGER,
            bp_sys INTEGER,
            bp_dia INTEGER,
            temp REAL,
            etco2 INTEGER,
            cardiac_rhythm TEXT,
            st_elevation BOOLEAN DEFAULT 0,
            pvc_present BOOLEAN DEFAULT 0,
            wide_qrs BOOLEAN DEFAULT 0,
            t_inversion BOOLEAN DEFAULT 0,
            noise_level REAL DEFAULT 0,
            additional_params JSON,
            UNIQUE(scenario_id, sequence_order),
            FOREIGN KEY(scenario_id) REFERENCES scenario_templates(id) ON DELETE CASCADE
        )`);

        // 34. Lab Tests Master Table - Complete lab test database
        db.run(`CREATE TABLE IF NOT EXISTS lab_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_code TEXT UNIQUE,
            test_name TEXT NOT NULL,
            test_group TEXT NOT NULL,
            category TEXT CHECK(category IN ('General', 'Male', 'Female')) DEFAULT 'General',
            specimen_type TEXT,
            min_value REAL,
            max_value REAL,
            unit TEXT NOT NULL,
            critical_low REAL,
            critical_high REAL,
            normal_samples JSON,
            description TEXT,
            clinical_significance TEXT,
            turnaround_minutes INTEGER DEFAULT 30,
            cost REAL,
            is_stat_available BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 35. Lab Panels Table - Pre-configured lab test panels
        db.run(`CREATE TABLE IF NOT EXISTS lab_panels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            panel_id TEXT UNIQUE NOT NULL,
            panel_name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            clinical_indication TEXT,
            is_stat_available BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            display_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 36. Panel Tests - Tests included in each panel
        db.run(`CREATE TABLE IF NOT EXISTS panel_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            panel_id INTEGER NOT NULL,
            lab_test_id INTEGER NOT NULL,
            preset_type TEXT CHECK(preset_type IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'custom')) DEFAULT 'normal',
            value_multiplier REAL DEFAULT 1.0,
            custom_value REAL,
            display_order INTEGER DEFAULT 0,
            UNIQUE(panel_id, lab_test_id),
            FOREIGN KEY(panel_id) REFERENCES lab_panels(id) ON DELETE CASCADE,
            FOREIGN KEY(lab_test_id) REFERENCES lab_tests(id) ON DELETE CASCADE
        )`);

        // 37. Investigation Templates - Radiology and other investigations
        db.run(`CREATE TABLE IF NOT EXISTS investigation_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            investigation_type TEXT CHECK(investigation_type IN ('lab', 'radiology', 'procedure', 'other')) NOT NULL,
            turnaround_minutes INTEGER DEFAULT 30,
            description TEXT,
            preparation_instructions TEXT,
            contraindications TEXT,
            cost REAL,
            is_stat_available BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 38. Investigation Parameters - Parameters for lab investigations
        db.run(`CREATE TABLE IF NOT EXISTS investigation_parameters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            investigation_id INTEGER NOT NULL,
            parameter_name TEXT NOT NULL,
            unit TEXT,
            normal_range_min REAL,
            normal_range_max REAL,
            critical_low REAL,
            critical_high REAL,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY(investigation_id) REFERENCES investigation_templates(id) ON DELETE CASCADE
        )`);

        // 39. Investigation Views - Views for radiology investigations
        db.run(`CREATE TABLE IF NOT EXISTS investigation_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            investigation_id INTEGER NOT NULL,
            view_name TEXT NOT NULL,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY(investigation_id) REFERENCES investigation_templates(id) ON DELETE CASCADE
        )`);

        // 40. Medications Table - Drug/medication database
        db.run(`CREATE TABLE IF NOT EXISTS medications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medication_code TEXT UNIQUE,
            generic_name TEXT NOT NULL,
            brand_names JSON,
            drug_class TEXT,
            category TEXT,
            route TEXT CHECK(route IN ('oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'sublingual', 'rectal', 'other')),
            typical_dose TEXT,
            dose_unit TEXT,
            frequency TEXT,
            max_daily_dose TEXT,
            onset_minutes INTEGER,
            duration_minutes INTEGER,
            half_life_hours REAL,
            indications JSON,
            contraindications JSON,
            side_effects JSON,
            interactions JSON,
            monitoring_parameters JSON,
            pregnancy_category TEXT,
            is_controlled BOOLEAN DEFAULT 0,
            is_high_alert BOOLEAN DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 41. Medication Doses - Pre-configured dose options
        db.run(`CREATE TABLE IF NOT EXISTS medication_doses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medication_id INTEGER NOT NULL,
            dose_description TEXT NOT NULL,
            dose_value REAL,
            dose_unit TEXT,
            route TEXT,
            frequency TEXT,
            indication TEXT,
            is_default BOOLEAN DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY(medication_id) REFERENCES medications(id) ON DELETE CASCADE
        )`);

        // 42. Search Aliases Table - Search shortcuts and aliases
        db.run(`CREATE TABLE IF NOT EXISTS search_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alias_term TEXT NOT NULL,
            alias_type TEXT CHECK(alias_type IN ('lab', 'medication', 'investigation', 'panel', 'diagnosis')) NOT NULL,
            target_ids JSON NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT 1,
            UNIQUE(alias_term, alias_type)
        )`);

        // 43. Vital Sign Definitions - Normal ranges and alarm thresholds
        db.run(`CREATE TABLE IF NOT EXISTS vital_sign_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vital_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            abbreviation TEXT,
            unit TEXT NOT NULL,
            normal_min REAL,
            normal_max REAL,
            critical_low REAL,
            critical_high REAL,
            alarm_low REAL,
            alarm_high REAL,
            decimal_places INTEGER DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            color_code TEXT,
            is_active BOOLEAN DEFAULT 1
        )`);

        // 44. Diagnoses/Conditions Table - ICD codes and conditions
        db.run(`CREATE TABLE IF NOT EXISTS diagnoses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            icd_code TEXT,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            body_system TEXT,
            severity TEXT CHECK(severity IN ('mild', 'moderate', 'severe', 'critical')),
            typical_findings JSON,
            differential_diagnoses JSON,
            workup_recommendations JSON,
            treatment_guidelines JSON,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 45. Clinical Pathways Table - Treatment protocols
        db.run(`CREATE TABLE IF NOT EXISTS clinical_pathways (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pathway_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            condition_id INTEGER,
            steps JSON NOT NULL,
            duration_hours INTEGER,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(condition_id) REFERENCES diagnoses(id)
        )`);

        // ============================================
        // MIGRATIONS - Add missing columns to existing tables
        // ============================================

        // Users table migrations
        db.all("PRAGMA table_info(users)", (err, rows) => {
            if (rows) {
                const addColumn = (name, def) => {
                    if (!rows.find(r => r.name === name)) {
                        db.run(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
                    }
                };
                addColumn('department', 'TEXT');
                addColumn('status', "TEXT DEFAULT 'active'");
                addColumn('last_login', 'DATETIME');
                addColumn('failed_login_attempts', 'INTEGER DEFAULT 0');
                addColumn('locked_until', 'DATETIME');
                // SQLite doesn't allow CURRENT_TIMESTAMP as default in ALTER TABLE
                addColumn('updated_at', 'DATETIME');
                addColumn('deleted_at', 'DATETIME');
                // User profile fields
                addColumn('institution', 'TEXT');
                addColumn('address', 'TEXT');
                addColumn('phone', 'TEXT');
                addColumn('alternative_email', 'TEXT');
                addColumn('education', 'TEXT');
                addColumn('grade', 'TEXT');
            }
        });

        // Cases table migrations
        db.all("PRAGMA table_info(cases)", (err, rows) => {
            if (rows) {
                const addColumn = (name, def) => {
                    if (!rows.find(r => r.name === name)) {
                        db.run(`ALTER TABLE cases ADD COLUMN ${name} ${def}`);
                    }
                };
                addColumn('patient_name', 'TEXT');
                addColumn('patient_gender', 'TEXT');
                addColumn('patient_age', 'INTEGER');
                addColumn('chief_complaint', 'TEXT');
                addColumn('difficulty_level', 'TEXT');
                addColumn('estimated_duration_minutes', 'INTEGER');
                addColumn('learning_objectives', 'JSON');
                addColumn('version', 'INTEGER DEFAULT 1');
                addColumn('is_published', 'BOOLEAN DEFAULT 0');
                addColumn('published_at', 'DATETIME');
                addColumn('created_by', 'INTEGER');
                addColumn('last_modified_by', 'INTEGER');
                // SQLite doesn't allow CURRENT_TIMESTAMP as default in ALTER TABLE
                addColumn('updated_at', 'DATETIME');
                addColumn('deleted_at', 'DATETIME');
            }
        });

        // Sessions table migrations
        db.all("PRAGMA table_info(sessions)", (err, rows) => {
            if (rows) {
                const addColumn = (name, def) => {
                    if (!rows.find(r => r.name === name)) {
                        db.run(`ALTER TABLE sessions ADD COLUMN ${name} ${def}`);
                    }
                };
                addColumn('status', "TEXT DEFAULT 'active'");
                addColumn('case_version', 'INTEGER');
                addColumn('exam_findings_count', 'INTEGER DEFAULT 0');
                addColumn('investigation_count', 'INTEGER DEFAULT 0');
                addColumn('message_count', 'INTEGER DEFAULT 0');
                addColumn('performance_score', 'REAL');
                addColumn('instructor_notes', 'TEXT');
                // SQLite doesn't allow CURRENT_TIMESTAMP as default in ALTER TABLE
                addColumn('updated_at', 'DATETIME');
                addColumn('deleted_at', 'DATETIME');
            }
        });

        // Learning events table migrations
        db.all("PRAGMA table_info(learning_events)", (err, rows) => {
            if (rows) {
                const addColumn = (name, def) => {
                    if (!rows.find(r => r.name === name)) {
                        db.run(`ALTER TABLE learning_events ADD COLUMN ${name} ${def}`);
                    }
                };
                addColumn('severity', 'TEXT');
                addColumn('category', 'TEXT');
            }
        });

        // Interactions table migrations (soft delete)
        db.all("PRAGMA table_info(interactions)", (err, rows) => {
            if (rows && !rows.find(r => r.name === 'deleted_at')) {
                db.run("ALTER TABLE interactions ADD COLUMN deleted_at DATETIME");
            }
        });

        // ============================================
        // INDEXES - Performance optimization
        // ============================================

        // Learning events indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_learning_events_session ON learning_events(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_learning_events_user ON learning_events(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_learning_events_verb ON learning_events(verb)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_learning_events_timestamp ON learning_events(timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_learning_events_case_id ON learning_events(case_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_learning_events_object_type ON learning_events(object_type)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_learning_events_composite ON learning_events(session_id, timestamp)`);

        // Users indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`);

        // Sessions indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_case_id ON sessions(case_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_composite ON sessions(user_id, case_id)`);

        // Cases indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_cases_is_available ON cases(is_available)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_cases_is_default ON cases(is_default)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_cases_difficulty ON cases(difficulty_level)`);

        // Interactions indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_interactions_session_id ON interactions(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp)`);

        // Investigation orders indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_investigation_orders_session_id ON investigation_orders(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_investigation_orders_viewed_at ON investigation_orders(viewed_at)`);

        // Login logs indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_user_id ON login_logs(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_timestamp ON login_logs(timestamp DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_action ON login_logs(action)`);

        // Settings logs indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_settings_logs_user_id ON settings_logs(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_settings_logs_timestamp ON settings_logs(timestamp DESC)`);

        // Physical exam findings indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_physical_exam_session ON physical_exam_findings(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_physical_exam_case ON physical_exam_findings(case_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_physical_exam_region ON physical_exam_findings(body_region)`);

        // System audit log indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_user ON system_audit_log(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON system_audit_log(timestamp DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON system_audit_log(resource_type, resource_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON system_audit_log(action)`);

        // Case versions indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_case_versions_case ON case_versions(case_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_case_versions_timestamp ON case_versions(change_timestamp DESC)`);

        // Vital sign history indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_vital_history_session ON vital_sign_history(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_vital_history_composite ON vital_sign_history(session_id, recorded_at)`);

        // Active sessions indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON active_sessions(token_hash)`);

        // Lab definitions indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_definitions_name ON lab_definitions(test_name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_definitions_group ON lab_definitions(test_group)`);

        // Alarm events indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_alarm_events_session_id ON alarm_events(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_alarm_events_triggered ON alarm_events(triggered_at)`);

        // Clinical notes indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_clinical_notes_session ON clinical_notes(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_clinical_notes_user ON clinical_notes(user_id)`);

        // ============================================
        // MASTER DATA INDEXES
        // ============================================

        // Body regions indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_body_regions_region_id ON body_regions(region_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_body_regions_view ON body_regions(anatomical_view)`);

        // Body map coordinates indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_body_map_region ON body_map_coordinates(region_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_body_map_gender_view ON body_map_coordinates(gender, view)`);

        // Scenario templates indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_scenario_templates_id ON scenario_templates(template_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_scenario_templates_category ON scenario_templates(category)`);

        // Scenario timeline indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_scenario_timeline_scenario ON scenario_timeline_points(scenario_id)`);

        // Lab tests indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_tests_name ON lab_tests(test_name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_tests_group ON lab_tests(test_group)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_tests_category ON lab_tests(category)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_tests_code ON lab_tests(test_code)`);

        // Lab panels indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_panels_id ON lab_panels(panel_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_lab_panels_category ON lab_panels(category)`);

        // Panel tests indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_panel_tests_panel ON panel_tests(panel_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_panel_tests_lab ON panel_tests(lab_test_id)`);

        // Investigation templates indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_investigation_templates_id ON investigation_templates(template_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_investigation_templates_type ON investigation_templates(investigation_type)`);

        // Medications indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(generic_name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_medications_class ON medications(drug_class)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_medications_code ON medications(medication_code)`);

        // Search aliases indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_search_aliases_term ON search_aliases(alias_term)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_search_aliases_type ON search_aliases(alias_type)`);

        // Diagnoses indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_diagnoses_icd ON diagnoses(icd_code)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_diagnoses_name ON diagnoses(name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_diagnoses_system ON diagnoses(body_system)`);

        // ============================================
        // LLM USAGE TRACKING & RATE LIMITING TABLES
        // ============================================

        // LLM Usage - Daily aggregates per user
        db.run(`CREATE TABLE IF NOT EXISTS llm_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date DATE NOT NULL,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            estimated_cost REAL DEFAULT 0,
            model TEXT,
            request_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, date),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // LLM Request Log - Detailed audit trail
        db.run(`CREATE TABLE IF NOT EXISTS llm_request_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id INTEGER,
            model TEXT,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            estimated_cost REAL,
            status TEXT CHECK(status IN ('success', 'error', 'rate_limited')) DEFAULT 'success',
            error_message TEXT,
            request_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            response_time_ms INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )`);

        // LLM Model Pricing - Cost calculation reference
        db.run(`CREATE TABLE IF NOT EXISTS llm_model_pricing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            input_cost_per_1k REAL NOT NULL,
            output_cost_per_1k REAL NOT NULL,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(provider, model)
        )`);

        // LLM Usage indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_user_date ON llm_usage(user_id, date)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_date ON llm_usage(date)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_llm_request_log_user ON llm_request_log(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_llm_request_log_timestamp ON llm_request_log(request_timestamp)`);

        // Seed default model pricing
        const defaultPricing = [
            ['openai', 'gpt-3.5-turbo', 0.0005, 0.0015],
            ['openai', 'gpt-4', 0.03, 0.06],
            ['openai', 'gpt-4-turbo', 0.01, 0.03],
            ['openai', 'gpt-4o', 0.005, 0.015],
            ['openai', 'gpt-4o-mini', 0.00015, 0.0006],
            ['ollama', 'default', 0, 0],
            ['lmstudio', 'default', 0, 0]
        ];

        const pricingStmt = db.prepare(`INSERT OR IGNORE INTO llm_model_pricing (provider, model, input_cost_per_1k, output_cost_per_1k) VALUES (?, ?, ?, ?)`);
        defaultPricing.forEach(([provider, model, input, output]) => {
            pricingStmt.run(provider, model, input, output);
        });
        pricingStmt.finalize();

        // ============================================
        // PATIENT RECORD MEMORY MODULE TABLES
        // ============================================

        // Patient Record Events - Individual events with 8 verbs
        db.run(`CREATE TABLE IF NOT EXISTS patient_record_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            record_id TEXT NOT NULL,
            event_id TEXT NOT NULL UNIQUE,
            verb TEXT NOT NULL CHECK(verb IN ('OBTAINED', 'EXAMINED', 'ELICITED', 'NOTED', 'ORDERED', 'ADMINISTERED', 'CHANGED', 'EXPRESSED')),
            time_elapsed INTEGER NOT NULL,
            category TEXT,
            region TEXT,
            source TEXT,
            item TEXT,
            content TEXT,
            finding TEXT,
            value TEXT,
            unit TEXT,
            abnormal BOOLEAN,
            details JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )`);

        // Patient Record Documents - Full formatted JSON document per session
        db.run(`CREATE TABLE IF NOT EXISTS patient_record_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL UNIQUE,
            record_id TEXT NOT NULL UNIQUE,
            patient_info JSON NOT NULL,
            current_state JSON,
            events_count INTEGER DEFAULT 0,
            document JSON NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )`);

        // Patient Record indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_patient_record_events_session ON patient_record_events(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_patient_record_events_record ON patient_record_events(record_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_patient_record_events_verb ON patient_record_events(verb)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_patient_record_events_time ON patient_record_events(time_elapsed)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_patient_record_documents_session ON patient_record_documents(session_id)`);

        // ==================== MULTI-AGENT SYSTEM ====================

        // Agent Templates - reusable personas created by admin
        db.run(`CREATE TABLE IF NOT EXISTS agent_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_type TEXT NOT NULL,
            name TEXT NOT NULL,
            role_title TEXT,
            avatar_url TEXT,
            system_prompt TEXT NOT NULL,
            context_filter TEXT DEFAULT 'full',
            communication_style TEXT,
            is_default BOOLEAN DEFAULT 0,
            config JSON,
            -- LLM Configuration (optional override from platform default)
            llm_provider TEXT,
            llm_model TEXT,
            llm_api_key TEXT,
            llm_endpoint TEXT,
            llm_config JSON,
            -- Memory/PatientRecord Access Configuration
            memory_access JSON,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        )`);

        // Add columns to existing agent_templates table if they don't exist
        db.run(`ALTER TABLE agent_templates ADD COLUMN llm_provider TEXT`, (err) => { if (err && !err.message.includes('duplicate')) console.error('Error adding llm_provider column:', err.message); });
        db.run(`ALTER TABLE agent_templates ADD COLUMN llm_model TEXT`, (err) => { if (err && !err.message.includes('duplicate')) console.error('Error adding llm_model column:', err.message); });
        db.run(`ALTER TABLE agent_templates ADD COLUMN llm_api_key TEXT`, (err) => { if (err && !err.message.includes('duplicate')) console.error('Error adding llm_api_key column:', err.message); });
        db.run(`ALTER TABLE agent_templates ADD COLUMN llm_endpoint TEXT`, (err) => { if (err && !err.message.includes('duplicate')) console.error('Error adding llm_endpoint column:', err.message); });
        db.run(`ALTER TABLE agent_templates ADD COLUMN llm_config JSON`, (err) => { if (err && !err.message.includes('duplicate')) console.error('Error adding llm_config column:', err.message); });
        db.run(`ALTER TABLE agent_templates ADD COLUMN memory_access JSON`, (err) => { if (err && !err.message.includes('duplicate')) console.error('Error adding memory_access column:', err.message); });

        // Case Agents - which agents are enabled per case with overrides
        db.run(`CREATE TABLE IF NOT EXISTS case_agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL,
            agent_template_id INTEGER NOT NULL,
            enabled BOOLEAN DEFAULT 1,
            name_override TEXT,
            system_prompt_override TEXT,
            availability_type TEXT DEFAULT 'present',
            available_from_minute INTEGER DEFAULT 0,
            auto_arrive_minute INTEGER,
            depart_at_minute INTEGER,
            response_time_min INTEGER DEFAULT 0,
            response_time_max INTEGER DEFAULT 0,
            config_override JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(agent_template_id) REFERENCES agent_templates(id)
        )`);

        // Agent Conversations - chat history per session per agent
        db.run(`CREATE TABLE IF NOT EXISTS agent_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            agent_type TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )`);

        // Agent Session State - runtime state per session
        db.run(`CREATE TABLE IF NOT EXISTS agent_session_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            agent_type TEXT NOT NULL,
            status TEXT DEFAULT 'absent',
            paged_at DATETIME,
            arrived_at DATETIME,
            departed_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            UNIQUE(session_id, agent_type)
        )`);

        // Team Communications Log - shared context across agents
        db.run(`CREATE TABLE IF NOT EXISTS team_communications_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            agent_type TEXT NOT NULL,
            key_points TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )`);

        // Agent indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_agent_templates_type ON agent_templates(agent_type)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_case_agents_case ON case_agents(case_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_agent_conv_session ON agent_conversations(session_id, agent_type)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_agent_state_session ON agent_session_state(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_team_log_session ON team_communications_log(session_id)`);

        // ==================== SEED DEFAULT AGENT PERSONAS ====================
        seedDefaultAgents();

        console.log('Database tables initialized with comprehensive schema, master data tables, audit trails, and performance indexes.');
    });
}

export default db;
