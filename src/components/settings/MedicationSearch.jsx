import React, { useState, useEffect, useRef } from 'react';
import { Search, Pill, X } from 'lucide-react';
import { AuthService } from '../../services/authService';

/**
 * Medication autocomplete search component
 * Searches against the medications database and returns selected medication data
 */
export default function MedicationSearch({ value, onChange, onSelect, placeholder = 'Search medications...' }) {
    const [query, setQuery] = useState(value || '');
    const [results, setResults] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);

    // Sync query with external value
    useEffect(() => {
        setQuery(value || '');
    }, [value]);

    // Search medications when query changes
    useEffect(() => {
        const searchMedications = async () => {
            if (query.length < 2) {
                setResults([]);
                setIsOpen(false);
                return;
            }

            setLoading(true);
            try {
                const token = AuthService.getToken();
                const res = await fetch(`/api/master/medications?search=${encodeURIComponent(query)}&limit=10`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setResults(data.medications || []);
                    setIsOpen(true);
                    setSelectedIndex(-1);
                }
            } catch (err) {
                console.error('Failed to search medications:', err);
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(searchMedications, 200);
        return () => clearTimeout(debounce);
    }, [query]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
                inputRef.current && !inputRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleInputChange = (e) => {
        const newValue = e.target.value;
        setQuery(newValue);
        onChange?.(newValue);
    };

    const handleSelect = (medication) => {
        setQuery(medication.generic_name);
        onChange?.(medication.generic_name);
        onSelect?.(medication);
        setIsOpen(false);
        setResults([]);
    };

    const handleKeyDown = (e) => {
        if (!isOpen || results.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < results.length) {
                    handleSelect(results[selectedIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                break;
        }
    };

    const clearInput = () => {
        setQuery('');
        onChange?.('');
        setResults([]);
        setIsOpen(false);
        inputRef.current?.focus();
    };

    // Parse indications from JSON or string
    const parseIndications = (indications) => {
        if (!indications) return '';
        try {
            const parsed = typeof indications === 'string' ? JSON.parse(indications) : indications;
            if (Array.isArray(parsed)) {
                return parsed.slice(0, 2).join(', ');
            }
            return String(parsed).slice(0, 50);
        } catch {
            return String(indications).slice(0, 50);
        }
    };

    return (
        <div className="relative">
            <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-neutral-500" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => results.length > 0 && setIsOpen(true)}
                    className="input-dark text-xs pl-7 pr-7 w-full"
                    placeholder={placeholder}
                />
                {query && (
                    <button
                        type="button"
                        onClick={clearInput}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                    >
                        <X className="w-3 h-3" />
                    </button>
                )}
            </div>

            {/* Dropdown Results */}
            {isOpen && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 w-full mt-1 bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                >
                    {loading ? (
                        <div className="px-3 py-2 text-xs text-neutral-400">Searching...</div>
                    ) : results.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-neutral-400">No medications found</div>
                    ) : (
                        results.map((med, idx) => (
                            <button
                                key={med.id}
                                type="button"
                                onClick={() => handleSelect(med)}
                                className={`w-full px-3 py-2 text-left hover:bg-neutral-700 transition-colors ${
                                    idx === selectedIndex ? 'bg-neutral-700' : ''
                                }`}
                            >
                                <div className="flex items-start gap-2">
                                    <Pill className="w-3 h-3 text-purple-400 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-white truncate">
                                            {med.generic_name}
                                        </div>
                                        {med.category && (
                                            <div className="text-xs text-purple-400">{med.category}</div>
                                        )}
                                        {med.indications && (
                                            <div className="text-xs text-neutral-500 truncate">
                                                {parseIndications(med.indications)}
                                            </div>
                                        )}
                                        {(med.route || med.typical_dose) && (
                                            <div className="text-xs text-neutral-400 mt-0.5">
                                                {med.route && <span className="text-green-400">{med.route}</span>}
                                                {med.route && med.typical_dose && ' • '}
                                                {med.typical_dose && <span>{med.typical_dose}</span>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
