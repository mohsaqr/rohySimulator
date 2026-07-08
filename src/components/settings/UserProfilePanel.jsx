import React, { useState, useEffect } from 'react';
import {
    User, Mail, Phone, Building2, MapPin, GraduationCap,
    Lock, Save, Loader2, Eye, EyeOff, AlertCircle, CheckCircle,
    Bot, Server, Key, Hash, Globe
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { LANGUAGES } from '../../i18n/languages';
import { ApiError, apiFetch, apiPut } from '../../services/apiClient';
import JoinClassPanel from './JoinClassPanel';

/**
 * User Profile Panel
 * Allows users to view and edit their profile information and change password
 */
export default function UserProfilePanel({ _onClose }) {
    const { t } = useTranslation('profile');
    const toast = useToast();
    const { uiLanguage, setUiLanguage } = useLanguage();

    const handleLanguageChange = async (code) => {
        try {
            await setUiLanguage(code);
            toast.success(t('language_saved'));
        } catch (error) {
            toast.error(t('language_save_failed', { message: error?.message || t('unknown_error') }));
        }
    };

    const [activeTab, setActiveTab] = useState('profile'); // profile, password, ai
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // AI Settings
    const [aiSettings, setAiSettings] = useState({
        provider: '',
        model: '',
        baseUrl: '',
        apiKey: '',
        maxOutputTokens: '',
        temperature: ''
    });
    const [showApiKey, setShowApiKey] = useState(false);

    // Profile data
    const [profile, setProfile] = useState({
        username: '',
        name: '',
        email: '',
        institution: '',
        address: '',
        phone: '',
        alternative_email: '',
        education: '',
        grade: ''
    });

    // Field configuration from platform settings
    const [fieldConfig, setFieldConfig] = useState({});

    // Password change
    const [passwordData, setPasswordData] = useState({
        current_password: '',
        new_password: '',
        confirm_password: ''
    });
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);

    // Load profile, field config, and AI settings
    useEffect(() => {
        loadProfile();
        loadFieldConfig();
        loadAiSettings();
    }, []);

    const loadProfile = async () => {
        try {
            const data = await apiFetch('/user/profile');
            setProfile({
                username: data.user.username || '',
                name: data.user.name || '',
                email: data.user.email || '',
                institution: data.user.institution || '',
                address: data.user.address || '',
                phone: data.user.phone || '',
                alternative_email: data.user.alternative_email || '',
                education: data.user.education || '',
                grade: data.user.grade || ''
            });
        } catch (error) {
            if (error instanceof ApiError) {
                toast.error(t('profile_load_failed'));
            } else {
                toast.error(t('profile_load_failed_message', { message: error.message }));
            }
        } finally {
            setLoading(false);
        }
    };

    const loadFieldConfig = async () => {
        try {
            const data = await apiFetch('/platform-settings/user-fields');
            setFieldConfig(data.config || {});
        } catch (error) {
            console.error('Failed to load field config:', error);
        }
    };

    const loadAiSettings = async () => {
        try {
            const data = await apiFetch('/users/preferences');
            // Parse default_llm_settings if it's a string (from DB)
            let llmSettings = data.default_llm_settings;
            if (typeof llmSettings === 'string') {
                try {
                    llmSettings = JSON.parse(llmSettings);
                } catch {
                    llmSettings = null;
                }
            }
            if (llmSettings) {
                setAiSettings(prev => ({
                    ...prev,
                    ...llmSettings
                }));
            }
        } catch (error) {
            console.error('Failed to load AI settings:', error);
        }
    };

    const handleSaveAiSettings = async () => {
        setSaving(true);
        try {
            await apiPut('/users/preferences', {
                default_llm_settings: {
                    provider: aiSettings.provider || undefined,
                    model: aiSettings.model || undefined,
                    baseUrl: aiSettings.baseUrl || undefined,
                    apiKey: aiSettings.apiKey || undefined,
                    maxOutputTokens: aiSettings.maxOutputTokens || undefined,
                    temperature: aiSettings.temperature || undefined
                }
            });
            toast.success(t('ai_settings_saved'));
        } catch (error) {
            if (error instanceof ApiError) {
                toast.error(error.body?.error || t('ai_settings_save_failed'));
            } else {
                toast.error(t('ai_settings_save_failed_message', { message: error.message }));
            }
        } finally {
            setSaving(false);
        }
    };

    const handleProfileChange = (field, value) => {
        setProfile(prev => ({ ...prev, [field]: value }));
    };

    const handleSaveProfile = async () => {
        // Validate required fields
        for (const [field, config] of Object.entries(fieldConfig)) {
            if (config.required && config.enabled && !profile[field]) {
                toast.error(t('field_required', { label: config.label }));
                return;
            }
        }

        setSaving(true);
        try {
            await apiPut('/user/profile', {
                name: profile.name,
                institution: profile.institution,
                address: profile.address,
                phone: profile.phone,
                alternative_email: profile.alternative_email,
                education: profile.education,
                grade: profile.grade
            });
            toast.success(t('profile_updated'));
        } catch (error) {
            if (error instanceof ApiError) {
                toast.error(error.body?.error || t('profile_update_failed'));
            } else {
                toast.error(t('profile_update_failed_message', { message: error.message }));
            }
        } finally {
            setSaving(false);
        }
    };

    const handleChangePassword = async () => {
        if (!passwordData.current_password || !passwordData.new_password) {
            toast.error(t('password_fields_required'));
            return;
        }

        if (passwordData.new_password !== passwordData.confirm_password) {
            toast.error(t('passwords_new_do_not_match'));
            return;
        }

        if (passwordData.new_password.length < 6) {
            toast.error(t('password_min_length'));
            return;
        }

        setSaving(true);
        try {
            await apiPut('/user/password', {
                current_password: passwordData.current_password,
                new_password: passwordData.new_password
            });
            toast.success(t('password_changed'));
            setPasswordData({
                current_password: '',
                new_password: '',
                confirm_password: ''
            });
        } catch (error) {
            if (error instanceof ApiError) {
                toast.error(error.body?.error || t('password_change_failed'));
            } else {
                toast.error(t('password_change_failed_message', { message: error.message }));
            }
        } finally {
            setSaving(false);
        }
    };

    const renderField = (fieldKey, icon, type = 'text', placeholder = '', disabled = false) => {
        const config = fieldConfig[fieldKey];
        if (config && !config.enabled) return null;

        const Icon = icon;
        const isRequired = config?.required;
        const label = config?.label || fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1).replace(/_/g, ' ');

        return (
            <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-400 flex items-center gap-1">
                    {label}
                    {isRequired && <span className="text-red-400">*</span>}
                </label>
                <div className="relative">
                    <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input
                        type={type}
                        value={profile[fieldKey] || ''}
                        onChange={(e) => handleProfileChange(fieldKey, e.target.value)}
                        disabled={disabled}
                        placeholder={placeholder}
                        className={`w-full pl-10 pr-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                    />
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-neutral-900 text-white">
            {/* Header */}
            <div className="px-6 py-4 border-b border-neutral-800">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <User className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">{profile.name || profile.username}</h2>
                        <p className="text-sm text-neutral-400">{profile.email}</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="px-6 py-3 border-b border-neutral-800">
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('profile')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === 'profile'
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                    >
                        <User className="w-4 h-4 inline mr-2" />
                        {t('profile')}
                    </button>
                    <button
                        onClick={() => setActiveTab('password')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === 'password'
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                    >
                        <Lock className="w-4 h-4 inline mr-2" />
                        {t('password')}
                    </button>
                    <button
                        onClick={() => setActiveTab('ai')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === 'ai'
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                    >
                        <Bot className="w-4 h-4 inline mr-2" />
                        {t('ai_settings')}
                    </button>
                    <button
                        onClick={() => setActiveTab('join-class')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === 'join-class'
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                    >
                        <GraduationCap className="w-4 h-4 inline mr-2" />
                        {t('join_class')}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'profile' && (
                    <div className="space-y-6 max-w-2xl">
                        {/* Account Info (Read-only) */}
                        <div className="p-4 bg-neutral-800/50 rounded-lg border border-neutral-700">
                            <h3 className="text-sm font-bold text-neutral-300 mb-3 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-amber-500" />
                                {t('account_information')}
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-neutral-500">{t('username')}</label>
                                    <div className="px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-neutral-400">
                                        {profile.username}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-neutral-500">{t('email')}</label>
                                    <div className="px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-neutral-400">
                                        {profile.email}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Editable Fields */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-neutral-300">{t('personal_information')}</h3>

                            {renderField('name', User, 'text', t('placeholder_name'))}

                            <div className="grid grid-cols-2 gap-4">
                                {fieldConfig.institution?.enabled !== false && renderField('institution', Building2, 'text', t('placeholder_institution'))}
                                {fieldConfig.phone?.enabled !== false && renderField('phone', Phone, 'tel', t('placeholder_phone'))}
                            </div>

                            {fieldConfig.address?.enabled !== false && renderField('address', MapPin, 'text', t('placeholder_address'))}

                            {fieldConfig.alternative_email?.enabled !== false && renderField('alternative_email', Mail, 'email', t('placeholder_alternative_email'))}

                            <div className="grid grid-cols-2 gap-4">
                                {fieldConfig.education?.enabled !== false && renderField('education', GraduationCap, 'text', t('placeholder_education'))}
                                {fieldConfig.grade?.enabled !== false && renderField('grade', GraduationCap, 'text', t('placeholder_grade'))}
                            </div>
                        </div>

                        {/* Language preference — saves immediately (merge PUT),
                            independent of the profile Save button below. */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
                                <Globe className="w-4 h-4 text-blue-400" />
                                {t('language')}
                            </h3>
                            <select
                                value={uiLanguage}
                                onChange={(e) => handleLanguageChange(e.target.value)}
                                className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-neutral-200 focus:border-blue-500 focus:outline-none"
                            >
                                {Object.entries(LANGUAGES).map(([code, lang]) => (
                                    <option key={code} value={code}>
                                        {lang.native === lang.name ? lang.native : `${lang.native} (${lang.name})`}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-neutral-500">
                                {t('language_help')}
                            </p>
                        </div>

                        {/* Save Button */}
                        <div className="pt-4 border-t border-neutral-800">
                            <button
                                onClick={handleSaveProfile}
                                disabled={saving}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 text-white rounded-lg font-medium flex items-center gap-2"
                            >
                                {saving ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> {t('saving')}</>
                                ) : (
                                    <><Save className="w-4 h-4" /> {t('save_changes')}</>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'password' && (
                    <div className="space-y-6 max-w-md">
                        <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                            <p className="text-sm text-amber-200 flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                {t('password_intro')}
                            </p>
                        </div>

                        <div className="space-y-4">
                            {/* Current Password */}
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-400">{t('current_password')}</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input
                                        type={showCurrentPassword ? 'text' : 'password'}
                                        value={passwordData.current_password}
                                        onChange={(e) => setPasswordData(prev => ({ ...prev, current_password: e.target.value }))}
                                        placeholder={t('current_password_placeholder')}
                                        className="w-full pl-10 pr-10 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                    >
                                        {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* New Password */}
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-400">{t('new_password')}</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input
                                        type={showNewPassword ? 'text' : 'password'}
                                        value={passwordData.new_password}
                                        onChange={(e) => setPasswordData(prev => ({ ...prev, new_password: e.target.value }))}
                                        placeholder={t('new_password_placeholder')}
                                        className="w-full pl-10 pr-10 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                    >
                                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {passwordData.new_password && passwordData.new_password.length < 6 && (
                                    <p className="text-xs text-red-400">{t('password_too_short')}</p>
                                )}
                            </div>

                            {/* Confirm Password */}
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-400">{t('confirm_new_password')}</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input
                                        type={showNewPassword ? 'text' : 'password'}
                                        value={passwordData.confirm_password}
                                        onChange={(e) => setPasswordData(prev => ({ ...prev, confirm_password: e.target.value }))}
                                        placeholder={t('confirm_new_password_placeholder')}
                                        className="w-full pl-10 pr-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                {passwordData.confirm_password && passwordData.new_password !== passwordData.confirm_password && (
                                    <p className="text-xs text-red-400">{t('passwords_do_not_match')}</p>
                                )}
                                {passwordData.confirm_password && passwordData.new_password === passwordData.confirm_password && passwordData.new_password.length >= 6 && (
                                    <p className="text-xs text-green-400 flex items-center gap-1">
                                        <CheckCircle className="w-3 h-3" /> {t('passwords_match')}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Change Password Button */}
                        <div className="pt-4 border-t border-neutral-800">
                            <button
                                onClick={handleChangePassword}
                                disabled={saving || !passwordData.current_password || !passwordData.new_password || passwordData.new_password !== passwordData.confirm_password}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center gap-2"
                            >
                                {saving ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> {t('changing')}</>
                                ) : (
                                    <><Lock className="w-4 h-4" /> {t('change_password')}</>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'ai' && (
                    <div className="space-y-6 max-w-2xl">
                        <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                            <p className="text-sm text-blue-200 flex items-start gap-2">
                                <Bot className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                {t('ai_intro')}
                            </p>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-neutral-300">{t('ai_provider_configuration')}</h3>

                            {/* Provider */}
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-400">{t('provider')}</label>
                                <select
                                    value={aiSettings.provider}
                                    onChange={(e) => setAiSettings(prev => ({ ...prev, provider: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="">{t('use_platform_default')}</option>
                                    <option value="openai">OpenAI</option>
                                    <option value="anthropic">Anthropic (Claude)</option>
                                    <option value="lmstudio">LM Studio (Local)</option>
                                    <option value="ollama">Ollama (Local)</option>
                                    <option value="openrouter">OpenRouter</option>
                                    <option value="groq">Groq</option>
                                    <option value="together">Together AI</option>
                                </select>
                            </div>

                            {/* Model */}
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-400">{t('model')}</label>
                                <div className="relative">
                                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={aiSettings.model}
                                        onChange={(e) => setAiSettings(prev => ({ ...prev, model: e.target.value }))}
                                        placeholder={t('model_placeholder')}
                                        className="w-full pl-10 pr-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* Base URL */}
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-400">{t('api_base_url')}</label>
                                <div className="relative">
                                    <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={aiSettings.baseUrl}
                                        onChange={(e) => setAiSettings(prev => ({ ...prev, baseUrl: e.target.value }))}
                                        placeholder={t('api_base_url_placeholder')}
                                        className="w-full pl-10 pr-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* API Key */}
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-400">{t('api_key')}</label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input
                                        type={showApiKey ? 'text' : 'password'}
                                        value={aiSettings.apiKey}
                                        onChange={(e) => setAiSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                                        placeholder={t('api_key_placeholder')}
                                        className="w-full pl-10 pr-10 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                    >
                                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Advanced Settings */}
                            <h3 className="text-sm font-bold text-neutral-300 pt-4">{t('advanced_settings')}</h3>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Max Output Tokens */}
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-neutral-400">{t('max_output_tokens')}</label>
                                    <input
                                        type="number"
                                        value={aiSettings.maxOutputTokens}
                                        onChange={(e) => setAiSettings(prev => ({ ...prev, maxOutputTokens: e.target.value }))}
                                        placeholder={t('max_output_tokens_placeholder')}
                                        className="w-full px-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                {/* Temperature */}
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-neutral-400">{t('temperature')}</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max="2"
                                        value={aiSettings.temperature}
                                        onChange={(e) => setAiSettings(prev => ({ ...prev, temperature: e.target.value }))}
                                        placeholder={t('temperature_placeholder')}
                                        className="w-full px-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Save Button */}
                        <div className="pt-4 border-t border-neutral-800">
                            <button
                                onClick={handleSaveAiSettings}
                                disabled={saving}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 text-white rounded-lg font-medium flex items-center gap-2"
                            >
                                {saving ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> {t('saving')}</>
                                ) : (
                                    <><Save className="w-4 h-4" /> {t('save_ai_settings')}</>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'join-class' && (
                    <JoinClassPanel />
                )}
            </div>
        </div>
    );
}
