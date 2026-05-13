import express from 'express';
import { findDefaultAgent } from '../db.js';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    requireEducator,
} from '../middleware/auth.js';


import {
    REDACTED,
} from '../redaction.js';
import { logger } from '../logger.js';
import {
    auditSuccess,
    logAudit,
    redactRow,
    tenantId
} from './_helpers.js';
import { toSqliteUtc, sqliteTsToIso } from '../sqliteTime.js';

const radiologyLog = logger('radiology');
const routesAdminLog = logger('routes-agent-tna-admin');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let radiologyDatabase = [];
try {
    const radiologyPath = path.join(__dirname, '../data/radiology_database.json');
    if (fs.existsSync(radiologyPath)) {
        const data = JSON.parse(fs.readFileSync(radiologyPath, 'utf8'));
        radiologyDatabase = data.studies || [];
        radiologyLog.info('radiology database loaded', { count: radiologyDatabase.length });
    }
} catch (err) {
    radiologyLog.error('radiology database load failed', { error: err.message });
}

const router = express.Router();

router.get('/agents/templates', authenticateToken, async (req, res) => {
    try {
        const templates = await new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT * FROM agent_templates WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, agent_type ASC, name ASC`,
                [tenantId(req)],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const parsed = templates.map(t => ({
            ...redactRow(t),
            config: JSON.parse(t.config || '{}'),
            is_default: t.is_default === 1
        }));

        res.json({ templates: parsed });
    } catch (err) {
        (req.log || routesAdminLog).error('agent templates list failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// GET /api/agents/templates/:id - Get single agent template
router.get('/agents/templates/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const template = await new Promise((resolve, reject) => {
            dbAdapter.get(
                'SELECT * FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
                [id, tenantId(req)],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        res.json({
            ...redactRow(template),
            config: JSON.parse(template.config || '{}'),
            is_default: template.is_default === 1
        });
    } catch (err) {
        (req.log || routesAdminLog).error('agent template get failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/agents/templates - Create agent template (admin only)
router.post('/agents/templates', authenticateToken, requireEducator, async (req, res) => {
    try {
        const {
            agent_type,
            name,
            role_title,
            avatar_url,
            system_prompt,
            context_filter = 'full',
            communication_style,
            config = {},
            // LLM configuration
            llm_provider,
            llm_model,
            llm_api_key,
            llm_endpoint,
            llm_config,
            llm_temperature,
            llm_max_tokens,
            // Memory access configuration
            memory_access
        } = req.body;

        if (!agent_type || !name || !system_prompt) {
            return res.status(400).json({ error: 'agent_type, name, and system_prompt are required' });
        }

        // Stage-4 audit: temperature/max_tokens parsed defensively. Empty
        // strings and non-finite values store as NULL so the resolver falls
        // through to session/platform; finite numbers persist as-is.
        const tempVal = (llm_temperature !== undefined && llm_temperature !== null && llm_temperature !== '' && Number.isFinite(parseFloat(llm_temperature)))
            ? parseFloat(llm_temperature) : null;
        const maxTokensVal = (llm_max_tokens !== undefined && llm_max_tokens !== null && llm_max_tokens !== '' && Number.isFinite(parseInt(llm_max_tokens, 10)))
            ? parseInt(llm_max_tokens, 10) : null;

        const result = await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO agent_templates
                 (agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style, config,
                  llm_provider, llm_model, llm_api_key, llm_endpoint, llm_config, llm_temperature, llm_max_tokens, memory_access, created_by, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style,
                    JSON.stringify(config),
                    llm_provider || null, llm_model || null, llm_api_key || null, llm_endpoint || null,
                    llm_config ? JSON.stringify(llm_config) : null,
                    tempVal, maxTokensVal,
                    memory_access ? JSON.stringify(memory_access) : null,
                    req.user.id,
                    tenantId(req)
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'create_agent_template',
            resourceType: 'agent_template',
            resourceId: result.id.toString(),
            resourceName: name,
            newValue: { agent_type, name, tenant_id: tenantId(req) },
            tenantId: tenantId(req)
        });

        res.status(201).json({ id: result.id, message: 'Agent template created' });
    } catch (err) {
        (req.log || routesAdminLog).error('agent template create failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/agents/templates/:id - Update agent template (admin only)
router.put('/agents/templates/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const { id } = req.params;

        // Admins are allowed to edit standard (is_default=1) templates in
        // place — the shipped DEFAULT_AGENTS array is the recoverable
        // baseline (POST .../reset-to-default re-applies it). We still
        // 404 on missing rows so the UI gets a sensible signal.
        const existing = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!existing) {
            return res.status(404).json({ error: 'Agent template not found' });
        }
        // agent_type is the immutable identity for shipped standards — the
        // seeder uses it to detect "is there already a default of this type"
        // and reset's fallback resolves baseline by type. Allowing admins to
        // re-tag a standard's type would let them silently swap which
        // baseline applies on reset. Lock it for is_default=1 rows.
        if (existing.is_default === 1
            && req.body.agent_type !== undefined
            && req.body.agent_type !== existing.agent_type) {
            return res.status(400).json({
                error: 'Cannot change agent_type on a standard template. Duplicate it first if you want a different type.'
            });
        }

        const {
            agent_type,
            name,
            role_title,
            avatar_url,
            system_prompt,
            context_filter,
            communication_style,
            config,
            // LLM configuration
            llm_provider,
            llm_model,
            llm_api_key,
            llm_endpoint,
            llm_config,
            llm_temperature,
            llm_max_tokens,
            // Memory access configuration
            memory_access
        } = req.body;

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (agent_type !== undefined) { updates.push('agent_type = ?'); params.push(agent_type); }
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (role_title !== undefined) { updates.push('role_title = ?'); params.push(role_title); }
        if (avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(avatar_url); }
        if (system_prompt !== undefined) { updates.push('system_prompt = ?'); params.push(system_prompt); }
        if (context_filter !== undefined) { updates.push('context_filter = ?'); params.push(context_filter); }
        if (communication_style !== undefined) { updates.push('communication_style = ?'); params.push(communication_style); }
        if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
        // LLM fields
        if (llm_provider !== undefined) { updates.push('llm_provider = ?'); params.push(llm_provider || null); }
        if (llm_model !== undefined) { updates.push('llm_model = ?'); params.push(llm_model || null); }
        if (llm_api_key !== undefined && llm_api_key !== REDACTED) { updates.push('llm_api_key = ?'); params.push(llm_api_key || null); }
        if (llm_endpoint !== undefined) { updates.push('llm_endpoint = ?'); params.push(llm_endpoint || null); }
        if (llm_config !== undefined) { updates.push('llm_config = ?'); params.push(llm_config ? JSON.stringify(llm_config) : null); }
        // Stage-4: temperature + max_tokens. Empty string clears (resolver falls
        // back to session/platform); a finite number persists.
        if (llm_temperature !== undefined) {
            const v = (llm_temperature === null || llm_temperature === '') ? null : parseFloat(llm_temperature);
            updates.push('llm_temperature = ?');
            params.push(Number.isFinite(v) ? v : null);
        }
        if (llm_max_tokens !== undefined) {
            const v = (llm_max_tokens === null || llm_max_tokens === '') ? null : parseInt(llm_max_tokens, 10);
            updates.push('llm_max_tokens = ?');
            params.push(Number.isFinite(v) ? v : null);
        }
        // Memory access
        if (memory_access !== undefined) { updates.push('memory_access = ?'); params.push(memory_access ? JSON.stringify(memory_access) : null); }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `UPDATE agent_templates SET ${updates.join(', ')} WHERE id = ?`,
                params,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'update_agent_template',
            resourceType: 'agent_template',
            resourceId: id,
            resourceName: name ?? existing.name,
            oldValue: {
                id: existing.id,
                agent_type: existing.agent_type,
                name: existing.name,
                role_title: existing.role_title,
                avatar_url: existing.avatar_url,
                system_prompt: existing.system_prompt,
                context_filter: existing.context_filter,
                communication_style: existing.communication_style,
                config: existing.config,
                llm_provider: existing.llm_provider,
                llm_model: existing.llm_model,
                llm_endpoint: existing.llm_endpoint,
                llm_temperature: existing.llm_temperature,
                llm_max_tokens: existing.llm_max_tokens,
                memory_access: existing.memory_access
            },
            newValue: req.body
        });

        res.json({ success: true, message: 'Agent template updated' });
    } catch (err) {
        (req.log || routesAdminLog).error('agent template update failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/agents/templates/:id - Delete agent template (admin only)
router.delete('/agents/templates/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if it's a default template
        const template = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        if (template.is_default === 1) {
            return res.status(403).json({ error: 'Cannot delete a default template; duplicate it first' });
        }

        // The case_agents FK on agent_template_id was created without ON DELETE
        // CASCADE (and SQLite forbids retroactively adding it), so we clean up
        // dependent rows explicitly. Without this, deleting a custom persona
        // leaves orphaned case_agents rows whose JOIN to agent_templates
        // returns NULL — the case shows a phantom agent at runtime.
        const dependentRows = await new Promise((resolve, reject) => {
            dbAdapter.all('SELECT id, case_id FROM case_agents WHERE agent_template_id = ?', [id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        if (dependentRows.length > 0) {
            await new Promise((resolve, reject) => {
                dbAdapter.run('DELETE FROM case_agents WHERE agent_template_id = ?', [id], function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                });
            });
        }

        await new Promise((resolve, reject) => {
            dbAdapter.run('UPDATE agent_templates SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'delete_agent_template',
            resourceType: 'agent_template',
            resourceId: id,
            resourceName: template.name,
            metadata: dependentRows.length > 0
                ? { cascaded_case_agents: dependentRows.length, affected_case_ids: [...new Set(dependentRows.map(r => r.case_id))] }
                : null
        });

        const cascadedMsg = dependentRows.length > 0
            ? ` (also removed ${dependentRows.length} attached case-agent row${dependentRows.length === 1 ? '' : 's'})`
            : '';
        res.json({ success: true, message: `Agent template deleted${cascadedMsg}` });
    } catch (err) {
        (req.log || routesAdminLog).error('agent template delete failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/agents/templates/:id/reset-to-default
// Re-applies the shipped DEFAULT_AGENTS values onto a standard (is_default=1)
// template row. Lets admins edit shipped rows freely while still being able to
// recover the original prompt/dos/donts/avatar/voice slot. Custom templates
// (is_default=0) reject with 400 because there's no canonical baseline to
// restore — they should be edited or deleted instead.
router.post('/agents/templates/:id/reset-to-default', authenticateToken, requireEducator, async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!existing) {
            return res.status(404).json({ error: 'Agent template not found' });
        }
        if (existing.is_default !== 1) {
            return res.status(400).json({ error: 'Only standard templates can be reset to defaults' });
        }

        // Match by (agent_type, name) — both are stable identifiers in the
        // shipped array. Fall back to type-only if name was renamed by an
        // earlier admin tweak; this is the more useful behaviour than a 404.
        const baseline = findDefaultAgent(existing.agent_type, existing.name)
            || findDefaultAgent(existing.agent_type, null);
        if (!baseline) {
            return res.status(404).json({
                error: `No shipped baseline for agent_type "${existing.agent_type}". Cannot reset.`
            });
        }

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `UPDATE agent_templates SET
                    name = ?,
                    role_title = ?,
                    avatar_url = ?,
                    system_prompt = ?,
                    context_filter = ?,
                    communication_style = ?,
                    config = ?,
                    llm_provider = NULL,
                    llm_model = NULL,
                    llm_api_key = NULL,
                    llm_endpoint = NULL,
                    llm_config = NULL,
                    memory_access = NULL,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    baseline.name,
                    baseline.role_title || null,
                    baseline.avatar_url || null,
                    baseline.system_prompt,
                    baseline.context_filter,
                    baseline.communication_style,
                    baseline.config, // already a JSON string in DEFAULT_AGENTS
                    id
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        // Audit captures the full pre-reset row + the baseline applied so
        // a reset is reversible from the audit trail (admin can paste the
        // oldValue back through PUT to recover an accidental click).
        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'reset_agent_template_to_default',
            resourceType: 'agent_template',
            resourceId: id,
            resourceName: baseline.name,
            oldValue: {
                id: existing.id,
                agent_type: existing.agent_type,
                name: existing.name,
                role_title: existing.role_title,
                avatar_url: existing.avatar_url,
                system_prompt: existing.system_prompt,
                context_filter: existing.context_filter,
                communication_style: existing.communication_style,
                config: existing.config,
                llm_provider: existing.llm_provider,
                llm_model: existing.llm_model,
                llm_endpoint: existing.llm_endpoint,
                memory_access: existing.memory_access
            },
            newValue: {
                source: 'DEFAULT_AGENTS',
                agent_type: baseline.agent_type,
                name: baseline.name,
                role_title: baseline.role_title,
                avatar_url: baseline.avatar_url,
                context_filter: baseline.context_filter,
                communication_style: baseline.communication_style,
                config: baseline.config
            }
        });

        // Return the freshly-reset row so the client can rehydrate without
        // a separate GET.
        const fresh = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        res.json({ success: true, message: `Reset "${baseline.name}" to shipped defaults`, template: fresh });
    } catch (err) {
        (req.log || routesAdminLog).error('agent template reset failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/agents/templates/:id/test-llm - Test agent LLM configuration
router.post('/agents/templates/:id/test-llm', authenticateToken, requireEducator, async (req, res) => {
    try {
        const { id } = req.params;

        // Get template with LLM config
        const template = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        // Get provider config - use template override or fall back to platform default
        let provider = template.llm_provider;
        let model = template.llm_model;
        let apiKey = template.llm_api_key;
        let endpoint = template.llm_endpoint;

        // If no override, use platform defaults
        if (!provider) {
            const platformConfig = await new Promise((resolve, reject) => {
                dbAdapter.get('SELECT value FROM config WHERE key = ?', ['llm_provider'], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value || 'openai');
                });
            });
            provider = platformConfig;
        }

        if (!model) {
            const platformModel = await new Promise((resolve, reject) => {
                dbAdapter.get('SELECT value FROM config WHERE key = ?', ['llm_model'], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value || 'gpt-4o-mini');
                });
            });
            model = platformModel;
        }

        if (!apiKey) {
            const keyMap = {
                'openai': 'openai_api_key',
                'anthropic': 'anthropic_api_key',
                'openrouter': 'openrouter_api_key'
            };
            const keyName = keyMap[provider] || 'openai_api_key';
            const platformKey = await new Promise((resolve, reject) => {
                dbAdapter.get('SELECT value FROM config WHERE key = ?', [keyName], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value);
                });
            });
            apiKey = platformKey;
        }

        if (!endpoint && provider === 'custom') {
            const platformEndpoint = await new Promise((resolve, reject) => {
                dbAdapter.get('SELECT value FROM config WHERE key = ?', ['custom_llm_endpoint'], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value);
                });
            });
            endpoint = platformEndpoint;
        }

        if (!apiKey && provider !== 'custom') {
            return res.status(400).json({ error: `No API key configured for provider: ${provider}` });
        }

        // Build a simple test message
        const testMessages = [
            { role: 'system', content: template.system_prompt || 'You are a helpful assistant.' },
            { role: 'user', content: 'Please respond with a single sentence confirming you are working correctly.' }
        ];

        let response;
        const startTime = Date.now();

        if (provider === 'openai') {
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
                model: model || 'gpt-4o-mini',
                messages: testMessages,
                max_tokens: 100
            });
            response = completion.choices[0]?.message?.content;
        } else if (provider === 'anthropic') {
            const Anthropic = (await import('@anthropic-ai/sdk')).default;
            const anthropic = new Anthropic({ apiKey });
            const completion = await anthropic.messages.create({
                model: model || 'claude-3-5-sonnet-20241022',
                max_tokens: 100,
                system: testMessages[0].content,
                messages: [{ role: 'user', content: testMessages[1].content }]
            });
            response = completion.content[0]?.text;
        } else if (provider === 'openrouter') {
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({
                apiKey,
                baseURL: 'https://openrouter.ai/api/v1'
            });
            const completion = await openai.chat.completions.create({
                model: model || 'openai/gpt-4o-mini',
                messages: testMessages,
                max_tokens: 100
            });
            response = completion.choices[0]?.message?.content;
        } else if (provider === 'custom' && endpoint) {
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({
                apiKey: apiKey || 'not-needed',
                baseURL: endpoint
            });
            const completion = await openai.chat.completions.create({
                model: model || 'default',
                messages: testMessages,
                max_tokens: 100
            });
            response = completion.choices[0]?.message?.content;
        } else {
            return res.status(400).json({ error: `Unsupported provider: ${provider}` });
        }

        const latency = Date.now() - startTime;

        res.json({
            success: true,
            provider,
            model,
            latency_ms: latency,
            response,
            message: 'LLM connection test successful'
        });
    } catch (err) {
        (req.log || routesAdminLog).error('agent llm test failed', { error: err.message });
        res.status(500).json({
            success: false,
            error: err.message,
            message: 'LLM connection test failed'
        });
    }
});

// POST /api/agents/templates/:id/duplicate - Duplicate an agent template
router.post('/agents/templates/:id/duplicate', authenticateToken, requireEducator, async (req, res) => {
    try {
        const { id } = req.params;
        // The Standard/Custom UI calls this with no body (just a click). Tolerate
        // missing body or missing Content-Type without crashing on destructure.
        const { name: newName } = req.body || {};

        // Get original template
        const original = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!original) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        const duplicateName = newName || `${original.name} (Copy)`;

        const result = await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO agent_templates
                 (agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style, is_default, config, created_by,
                  llm_provider, llm_model, llm_api_key, llm_endpoint, llm_config, memory_access, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    original.agent_type,
                    duplicateName,
                    original.role_title,
                    original.avatar_url,
                    original.system_prompt,
                    original.context_filter,
                    original.communication_style,
                    original.config,
                    req.user.id,
                    original.llm_provider,
                    original.llm_model,
                    original.llm_api_key,
                    original.llm_endpoint,
                    original.llm_config,
                    original.memory_access,
                    tenantId(req)
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'duplicate_agent_template',
            resourceType: 'agent_template',
            resourceId: String(result.id),
            resourceName: duplicateName,
            oldValue: {
                id: original.id,
                agent_type: original.agent_type,
                name: original.name
            },
            newValue: { id: result.id, name: duplicateName, agent_type: original.agent_type, tenant_id: tenantId(req) },
            tenantId: tenantId(req)
        });

        res.status(201).json({ id: result.id, message: 'Agent template duplicated' });
    } catch (err) {
        (req.log || routesAdminLog).error('agent template duplicate failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// -------------------- CASE AGENTS (Per-Case Config) --------------------

// GET /api/cases/:caseId/agents - List agents configured for a case
router.get('/cases/:caseId/agents', authenticateToken, async (req, res) => {
    try {
        const { caseId } = req.params;

        const agents = await new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT ca.*, at.name as template_name, at.role_title as template_role_title,
                        at.system_prompt as template_system_prompt, at.agent_type,
                        at.avatar_url as template_avatar, at.context_filter as template_context_filter,
                        at.communication_style as template_communication_style, at.config as template_config
                 FROM case_agents ca
                 JOIN agent_templates at ON ca.agent_template_id = at.id
                 WHERE ca.case_id = ? AND ca.tenant_id = ? AND at.tenant_id = ?
                 ORDER BY at.agent_type ASC`,
                [caseId, tenantId(req), tenantId(req)],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Merge template data with overrides
        const parsed = agents.map(a => ({
            id: a.id,
            case_id: a.case_id,
            agent_template_id: a.agent_template_id,
            agent_type: a.agent_type,
            enabled: a.enabled === 1,
            // Use override if set, else template value
            name: a.name_override || a.template_name,
            role_title: a.template_role_title,
            avatar_url: a.template_avatar,
            system_prompt: a.system_prompt_override || a.template_system_prompt,
            context_filter: a.template_context_filter,
            communication_style: a.template_communication_style,
            // Availability config
            availability_type: a.availability_type,
            available_from_minute: a.available_from_minute,
            auto_arrive_minute: a.auto_arrive_minute,
            depart_at_minute: a.depart_at_minute,
            response_time_min: a.response_time_min,
            response_time_max: a.response_time_max,
            // Merged config
            config: {
                ...JSON.parse(a.template_config || '{}'),
                ...JSON.parse(a.config_override || '{}')
            },
            // Keep override flags for editing
            has_name_override: !!a.name_override,
            has_prompt_override: !!a.system_prompt_override,
            has_config_override: !!a.config_override
        }));

        res.json({ agents: parsed });
    } catch (err) {
        (req.log || routesAdminLog).error('case agents list failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/cases/:caseId/agents - Add agent to case
router.post('/cases/:caseId/agents', authenticateToken, async (req, res) => {
    try {
        const { caseId } = req.params;
        const {
            agent_template_id,
            enabled = true,
            name_override,
            system_prompt_override,
            availability_type = 'present',
            available_from_minute = 0,
            auto_arrive_minute,
            depart_at_minute,
            response_time_min = 0,
            response_time_max = 0,
            config_override
        } = req.body;

        if (!agent_template_id) {
            return res.status(400).json({ error: 'agent_template_id is required' });
        }

        // Check if template exists
        const template = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT id FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [agent_template_id, tenantId(req)], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        const result = await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO case_agents
                 (case_id, agent_template_id, enabled, name_override, system_prompt_override,
                  availability_type, available_from_minute, auto_arrive_minute, depart_at_minute,
                  response_time_min, response_time_max, config_override)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    caseId, agent_template_id, enabled ? 1 : 0, name_override, system_prompt_override,
                    availability_type, available_from_minute, auto_arrive_minute, depart_at_minute,
                    response_time_min, response_time_max, config_override ? JSON.stringify(config_override) : null
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        auditSuccess(req, {
            action: 'add_case_agent',
            resourceType: 'case_agent',
            resourceId: String(result.id),
            newValue: { caseId, ...req.body }
        });

        res.status(201).json({ id: result.id, message: 'Agent added to case' });
    } catch (err) {
        (req.log || routesAdminLog).error('case agent add failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/cases/:caseId/agents/:agentId - Update case agent config
router.put('/cases/:caseId/agents/:agentId', authenticateToken, async (req, res) => {
    try {
        const { caseId, agentId } = req.params;
        const {
            enabled,
            name_override,
            system_prompt_override,
            availability_type,
            available_from_minute,
            auto_arrive_minute,
            depart_at_minute,
            response_time_min,
            response_time_max,
            config_override
        } = req.body;

        const updates = [];
        const params = [];

        if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
        if (name_override !== undefined) { updates.push('name_override = ?'); params.push(name_override || null); }
        if (system_prompt_override !== undefined) { updates.push('system_prompt_override = ?'); params.push(system_prompt_override || null); }
        if (availability_type !== undefined) { updates.push('availability_type = ?'); params.push(availability_type); }
        if (available_from_minute !== undefined) { updates.push('available_from_minute = ?'); params.push(available_from_minute); }
        if (auto_arrive_minute !== undefined) { updates.push('auto_arrive_minute = ?'); params.push(auto_arrive_minute); }
        if (depart_at_minute !== undefined) { updates.push('depart_at_minute = ?'); params.push(depart_at_minute); }
        if (response_time_min !== undefined) { updates.push('response_time_min = ?'); params.push(response_time_min); }
        if (response_time_max !== undefined) { updates.push('response_time_max = ?'); params.push(response_time_max); }
        if (config_override !== undefined) { updates.push('config_override = ?'); params.push(config_override ? JSON.stringify(config_override) : null); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        const existing = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM case_agents WHERE id = ? AND case_id = ?', [agentId, caseId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!existing) {
            return res.status(404).json({ error: 'Case agent not found' });
        }

        params.push(agentId, caseId);

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `UPDATE case_agents SET ${updates.join(', ')} WHERE id = ? AND case_id = ?`,
                params,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        auditSuccess(req, {
            action: 'update_case_agent',
            resourceType: 'case_agent',
            resourceId: agentId,
            oldValue: existing,
            newValue: { caseId, ...req.body }
        });

        res.json({ success: true, message: 'Case agent updated' });
    } catch (err) {
        (req.log || routesAdminLog).error('case agent update failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/cases/:caseId/agents/:agentId - Remove agent from case
router.delete('/cases/:caseId/agents/:agentId', authenticateToken, async (req, res) => {
    try {
        const { caseId, agentId } = req.params;

        const existing = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM case_agents WHERE id = ? AND case_id = ?', [agentId, caseId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!existing) {
            return res.status(404).json({ error: 'Case agent not found' });
        }

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                'DELETE FROM case_agents WHERE id = ? AND case_id = ?',
                [agentId, caseId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        auditSuccess(req, {
            action: 'delete_case_agent',
            resourceType: 'case_agent',
            resourceId: agentId,
            oldValue: existing
        });

        res.json({ success: true, message: 'Agent removed from case' });
    } catch (err) {
        (req.log || routesAdminLog).error('case agent delete failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/cases/:caseId/agents/add-defaults - Add all default agents to case
router.post('/cases/:caseId/agents/add-defaults', authenticateToken, async (req, res) => {
    try {
        const { caseId } = req.params;

        // Get all default templates
        const defaults = await new Promise((resolve, reject) => {
            dbAdapter.all('SELECT * FROM agent_templates WHERE is_default = 1 AND tenant_id = ? AND deleted_at IS NULL', [tenantId(req)], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Insert each default agent for the case
        let addedCount = 0;
        for (const template of defaults) {
            const config = JSON.parse(template.config || '{}');
            try {
                await new Promise((resolve, reject) => {
                    dbAdapter.run(
                        `INSERT OR IGNORE INTO case_agents
                         (case_id, agent_template_id, enabled, availability_type, available_from_minute,
                          response_time_min, response_time_max)
                         VALUES (?, ?, 1, ?, 0, ?, ?)`,
                        [
                            caseId,
                            template.id,
                            config.typical_availability || 'present',
                            config.response_time?.min || 0,
                            config.response_time?.max || 0
                        ],
                        function(err) {
                            if (err) reject(err);
                            else {
                                if (this.changes > 0) addedCount++;
                                resolve(this.changes);
                            }
                        }
                    );
                });
            } catch {
                // Ignore duplicates
            }
        }

        auditSuccess(req, {
            action: 'add_default_case_agents',
            resourceType: 'case',
            resourceId: caseId,
            newValue: { added_count: addedCount }
        });

        res.json({ success: true, added: addedCount, message: `Added ${addedCount} default agents to case` });
    } catch (err) {
        (req.log || routesAdminLog).error('add default agents failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// -------------------- AGENT SESSION STATE (Runtime) --------------------

// GET /api/sessions/:sessionId/agents - Get agent states for session
router.get('/sessions/:sessionId/agents', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Get session to find case_id
        const session = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT case_id FROM sessions WHERE id = ?', [sessionId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Converge any paged agents whose ETA already passed before
        // returning the snapshot. One UPDATE per session — bounded by
        // the agent count, which is single digits in practice.
        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `UPDATE agent_session_state
                 SET status = 'present', arrived_at = CURRENT_TIMESTAMP
                 WHERE session_id = ?
                   AND status = 'paged' AND arrives_at IS NOT NULL
                   AND datetime(arrives_at) <= datetime('now')`,
                [sessionId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Get case agents with current session state
        const agents = await new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT ca.*, at.name as template_name, at.role_title, at.agent_type,
                        at.avatar_url, at.system_prompt as template_system_prompt,
                        at.context_filter, at.communication_style, at.config as template_config,
                        ass.status as session_status, ass.paged_at, ass.arrives_at,
                        ass.arrived_at, ass.departed_at
                 FROM case_agents ca
                 JOIN agent_templates at ON ca.agent_template_id = at.id
                 LEFT JOIN agent_session_state ass ON ass.session_id = ? AND ass.agent_type = at.agent_type
                 WHERE ca.case_id = ? AND ca.enabled = 1
                 ORDER BY at.agent_type ASC`,
                [sessionId, session.case_id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const parsed = agents.map(a => ({
            agent_type: a.agent_type,
            name: a.name_override || a.template_name,
            role_title: a.role_title,
            avatar_url: a.avatar_url,
            system_prompt: a.system_prompt_override || a.template_system_prompt,
            context_filter: a.context_filter,
            communication_style: a.communication_style,
            availability_type: a.availability_type,
            available_from_minute: a.available_from_minute,
            auto_arrive_minute: a.auto_arrive_minute,
            depart_at_minute: a.depart_at_minute,
            response_time_min: a.response_time_min,
            response_time_max: a.response_time_max,
            config: {
                ...JSON.parse(a.template_config || '{}'),
                ...JSON.parse(a.config_override || '{}')
            },
            // Session state — timestamps converted to ISO `…Z` so
            // the client's `new Date()` parses as UTC regardless of
            // local time zone. SQLite stores them in UTC but without
            // a `Z`, which V8 interprets as local time.
            status: a.session_status || 'absent',
            paged_at: sqliteTsToIso(a.paged_at),
            arrives_at: sqliteTsToIso(a.arrives_at),
            arrived_at: sqliteTsToIso(a.arrived_at),
            departed_at: sqliteTsToIso(a.departed_at)
        }));

        res.json({ agents: parsed });
    } catch (err) {
        (req.log || routesAdminLog).error('session agents list failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/agents/:agentType/page - Page an agent
//
// Computes the arrival ETA server-side and stamps it on the session
// state row. The client reads `arrives_at` from /agents and drives the
// countdown from there — meaning a refresh, room switch, or chat
// remount picks up exactly where it left off, instead of dropping the
// in-memory setTimeout the way the prior client-side timer did.
//
// Wait time is clamped to a 1–3 minute band regardless of what the
// case author configured. The intent is sim pacing: a real consult
// takes 20+ minutes, but inside a single training session we want the
// learner to feel the friction without the case grinding to a halt.
// Per-case `response_time_min/max` are honoured but capped — admins
// who want true minutes-long waits can adjust the band here later.
const PAGE_WAIT_MIN_SEC = 60;          // 1 min floor — feels like a page, not a snap
const PAGE_WAIT_MAX_SEC = 180;         // 3 min ceiling — keeps the sim moving

// `arrives_at` is stored in SQLite's `YYYY-MM-DD HH:MM:SS` shape so
// the auto-arrival comparison against CURRENT_TIMESTAMP works under
// lexicographic ordering — an ISO `T…Z` string sorts after the
// space-separated form for the same instant, so paged rows never
// flipped until the date rolled over (the bug Codex caught in
// review). On the way out the value is converted to ISO so the
// client's `new Date()` parses as UTC. See server/sqliteTime.js.

router.post('/sessions/:sessionId/agents/:agentType/page', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        // Pull the case-agent's configured response window so we honour
        // a tighter band (e.g. nurse wants "instant") but never let a
        // legacy 2–5 minute seed exceed our clamp.
        const agentRow = await new Promise((resolve, reject) => {
            dbAdapter.get(
                `SELECT ca.response_time_min, ca.response_time_max
                 FROM sessions s
                 JOIN case_agents ca ON ca.case_id = s.case_id
                 JOIN agent_templates at ON ca.agent_template_id = at.id
                 WHERE s.id = ? AND at.agent_type = ?`,
                [sessionId, agentType],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        const configuredMinSec = Math.max(0, (agentRow?.response_time_min || 0) * 60);
        const configuredMaxSec = Math.max(0, (agentRow?.response_time_max || 0) * 60);
        const minSec = Math.max(PAGE_WAIT_MIN_SEC, Math.min(PAGE_WAIT_MAX_SEC, configuredMinSec || PAGE_WAIT_MIN_SEC));
        const maxSec = Math.max(minSec, Math.min(PAGE_WAIT_MAX_SEC, configuredMaxSec || PAGE_WAIT_MAX_SEC));
        const waitSec = minSec + Math.floor(Math.random() * (maxSec - minSec + 1));
        const arrivesAtMs = Date.now() + waitSec * 1000;
        const arrivesAtDb = toSqliteUtc(arrivesAtMs);        // for SQL compare
        const arrivesAtIso = new Date(arrivesAtMs).toISOString(); // for client

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO agent_session_state (session_id, agent_type, status, paged_at, arrives_at, arrived_at)
                 VALUES (?, ?, 'paged', CURRENT_TIMESTAMP, ?, NULL)
                 ON CONFLICT(session_id, agent_type) DO UPDATE SET
                 status = 'paged', paged_at = CURRENT_TIMESTAMP, arrives_at = excluded.arrives_at, arrived_at = NULL`,
                [sessionId, agentType, arrivesAtDb],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({
            success: true,
            message: `Agent ${agentType} paged`,
            agent_type: agentType,
            status: 'paged',
            arrives_at: arrivesAtIso,
            wait_seconds: waitSec
        });
    } catch (err) {
        (req.log || routesAdminLog).error('page agent failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// Server-side auto-arrival: if a row is 'paged' and we're past its
// arrives_at, flip it to 'present' in-place. Used by the read paths
// below so the client never has to chase the transition itself —
// reading /agents is enough to converge state. Idempotent.
async function autoArriveIfDue(sessionId, agentType) {
    await new Promise((resolve, reject) => {
        dbAdapter.run(
            `UPDATE agent_session_state
             SET status = 'present', arrived_at = CURRENT_TIMESTAMP
             WHERE session_id = ? AND agent_type = ?
               AND status = 'paged' AND arrives_at IS NOT NULL
               AND datetime(arrives_at) <= datetime('now')`,
            [sessionId, agentType],
            (err) => err ? reject(err) : resolve()
        );
    });
}

// POST /api/sessions/:sessionId/agents/:agentType/arrive - Mark agent as arrived
router.post('/sessions/:sessionId/agents/:agentType/arrive', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO agent_session_state (session_id, agent_type, status, arrived_at)
                 VALUES (?, ?, 'present', CURRENT_TIMESTAMP)
                 ON CONFLICT(session_id, agent_type) DO UPDATE SET
                 status = 'present', arrived_at = CURRENT_TIMESTAMP`,
                [sessionId, agentType],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: `Agent ${agentType} arrived` });
    } catch (err) {
        (req.log || routesAdminLog).error('agent arrive failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/agents/:agentType/depart - Mark agent as departed
router.post('/sessions/:sessionId/agents/:agentType/depart', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `UPDATE agent_session_state SET status = 'departed', departed_at = CURRENT_TIMESTAMP
                 WHERE session_id = ? AND agent_type = ?`,
                [sessionId, agentType],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: `Agent ${agentType} departed` });
    } catch (err) {
        (req.log || routesAdminLog).error('agent depart failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions/:sessionId/agents/:agentType/status - Get single agent status
router.get('/sessions/:sessionId/agents/:agentType/status', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        await autoArriveIfDue(sessionId, agentType);

        const state = await new Promise((resolve, reject) => {
            dbAdapter.get(
                `SELECT * FROM agent_session_state WHERE session_id = ? AND agent_type = ?`,
                [sessionId, agentType],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        res.json({
            agent_type: agentType,
            status: state?.status || 'absent',
            paged_at: sqliteTsToIso(state?.paged_at),
            arrives_at: sqliteTsToIso(state?.arrives_at),
            arrived_at: sqliteTsToIso(state?.arrived_at),
            departed_at: sqliteTsToIso(state?.departed_at)
        });
    } catch (err) {
        (req.log || routesAdminLog).error('agent status failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// -------------------- AGENT CONVERSATIONS --------------------

// GET /api/sessions/:sessionId/agents/:agentType/conversation - Get conversation history
router.get('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        const messages = await new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT * FROM agent_conversations
                 WHERE session_id = ? AND agent_type = ?
                 ORDER BY created_at ASC`,
                [sessionId, agentType],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({ messages });
    } catch (err) {
        (req.log || routesAdminLog).error('agent conversation get failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/agents/:agentType/conversation - Add message to conversation
router.post('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;
        const { role, content } = req.body;

        if (!role || !content) {
            return res.status(400).json({ error: 'role and content are required' });
        }

        const result = await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO agent_conversations (session_id, agent_type, role, content)
                 VALUES (?, ?, ?, ?)`,
                [sessionId, agentType, role, content],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        res.status(201).json({ id: result.id, message: 'Message added' });
    } catch (err) {
        (req.log || routesAdminLog).error('agent conversation add failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/sessions/:sessionId/agents/:agentType/conversation - Clear conversation
router.delete('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `DELETE FROM agent_conversations WHERE session_id = ? AND agent_type = ?`,
                [sessionId, agentType],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: 'Conversation cleared' });
    } catch (err) {
        (req.log || routesAdminLog).error('agent conversation clear failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// -------------------- TEAM COMMUNICATIONS LOG --------------------

// GET /api/sessions/:sessionId/team-communications - Get team communications log
router.get('/sessions/:sessionId/team-communications', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        const log = await new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT * FROM team_communications_log
                 WHERE session_id = ?
                 ORDER BY created_at DESC`,
                [sessionId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({ log });
    } catch (err) {
        (req.log || routesAdminLog).error('team communications get failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/team-communications - Add entry to team log
router.post('/sessions/:sessionId/team-communications', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { agent_type, key_points } = req.body;

        if (!agent_type || !key_points) {
            return res.status(400).json({ error: 'agent_type and key_points are required' });
        }

        const result = await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO team_communications_log (session_id, agent_type, key_points)
                 VALUES (?, ?, ?)`,
                [sessionId, agent_type, key_points],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        res.status(201).json({ id: result.id, message: 'Entry added to team log' });
    } catch (err) {
        (req.log || routesAdminLog).error('team communications add failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});


// ============================================
// TNA (Transition Network Analysis) ENDPOINTS
// ============================================


export default router;
