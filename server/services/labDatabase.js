import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for the loaded lab database
let labDatabaseCache = null;
let groupsCache = null;

/**
 * Load and parse Lab_database.txt and additional lab files (e.g., heart.txt)
 * @returns {Array} Array of lab test objects
 */
export function loadLabDatabase() {
    if (labDatabaseCache) {
        return labDatabaseCache;
    }

    let allTests = [];

    // Load main lab database
    try {
        const labDbPath = path.resolve(__dirname, '../../Lab_database.txt');
        const data = fs.readFileSync(labDbPath, 'utf8');
        allTests = JSON.parse(data);
        console.log(`Loaded ${allTests.length} lab tests from Lab_database.txt`);
    } catch (error) {
        console.error('Error loading Lab_database.txt:', error);
    }

    // Load cardiac investigations from heart.txt
    try {
        const heartDbPath = path.resolve(__dirname, '../../heart.txt');
        if (fs.existsSync(heartDbPath)) {
            const heartData = fs.readFileSync(heartDbPath, 'utf8');
            const cardiacTests = JSON.parse(heartData);

            // Add cardiac tests, avoiding duplicates by test_name + category
            const existingKeys = new Set(allTests.map(t => `${t.test_name}|${t.category}`));
            const newCardiacTests = cardiacTests.filter(t => !existingKeys.has(`${t.test_name}|${t.category}`));

            allTests = [...allTests, ...newCardiacTests];
            console.log(`Loaded ${cardiacTests.length} cardiac tests from heart.txt (${newCardiacTests.length} new)`);
        }
    } catch (error) {
        console.error('Error loading heart.txt:', error);
    }

    labDatabaseCache = allTests;
    // Clear groups cache so it gets rebuilt with new tests
    groupsCache = null;
    console.log(`Total lab tests loaded: ${labDatabaseCache.length}`);
    return labDatabaseCache;
}

/**
 * Fuzzy search tests by name (case-insensitive)
 * @param {string} query - Search query
 * @param {number} limit - Maximum results to return
 * @returns {Array} Matching lab tests
 */
export function searchTests(query, limit = 50) {
    if (!query || query.trim() === '') {
        return [];
    }

    const tests = loadLabDatabase();
    const searchTerm = query.toLowerCase().trim();

    // Debug: Log search
    console.log(`[Lab Search] Query: "${query}", Total tests in cache: ${tests.length}`);

    // Simple fuzzy search: match partial test names
    const results = tests.filter(test =>
        test.test_name.toLowerCase().includes(searchTerm)
    );

    // Debug: Log matching cardiac tests
    const cardiacMatches = results.filter(t => t.group === 'Cardiology Crisis');
    if (cardiacMatches.length > 0) {
        console.log(`[Lab Search] Found ${cardiacMatches.length} cardiac matches for "${query}"`);
    }

    // Group by test name to show gender variations together
    const grouped = {};
    results.forEach(test => {
        if (!grouped[test.test_name]) {
            grouped[test.test_name] = [];
        }
        grouped[test.test_name].push(test);
    });

    console.log(`[Lab Search] Results: ${Object.keys(grouped).length} unique tests found`);

    // Return up to limit unique test names (with all gender variants)
    return Object.values(grouped).slice(0, limit);
}

/**
 * Get all tests by group
 * @param {string} groupName - Group name
 * @returns {Array} Tests in the group
 */
export function getTestsByGroup(groupName) {
    const tests = loadLabDatabase();
    return tests.filter(test => test.group === groupName);
}

/**
 * Get unique list of all test groups
 * @returns {Array} Sorted list of group names
 */
export function getAllGroups() {
    if (groupsCache) {
        return groupsCache;
    }

    const tests = loadLabDatabase();
    const groups = new Set(tests.map(test => test.group));
    groupsCache = Array.from(groups).sort();
    return groupsCache;
}

/**
 * Get specific test by exact name and gender
 * @param {string} testName - Exact test name
 * @param {string} gender - 'Male', 'Female', or 'Both'
 * @returns {Object|null} Test object or null
 */
export function getTestByNameAndGender(testName, gender) {
    const tests = loadLabDatabase();
    
    // Try exact match with gender
    let test = tests.find(t => 
        t.test_name === testName && 
        (t.category === gender || t.category === 'Both')
    );

    // If not found and gender specified, try opposite gender (fallback)
    if (!test && gender) {
        test = tests.find(t => t.test_name === testName);
    }

    return test || null;
}

/**
 * Get all variations of a test (all gender categories)
 * @param {string} testName - Test name
 * @returns {Array} All variations of the test
 */
export function getTestVariations(testName) {
    const tests = loadLabDatabase();

    // First try exact match
    let matches = tests.filter(t => t.test_name === testName);
    if (matches.length > 0) return matches;

    // Try case-insensitive exact match
    const lowerName = testName.toLowerCase();
    matches = tests.filter(t => t.test_name.toLowerCase() === lowerName);
    if (matches.length > 0) return matches;

    // Try normalized match (remove special chars and compare)
    const normalizedSearch = testName.toLowerCase().replace(/[^a-z0-9]/g, '');
    matches = tests.filter(t => {
        const normalizedTest = t.test_name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalizedTest === normalizedSearch;
    });
    if (matches.length > 0) return matches;

    // Try partial match (search term contained in test name)
    matches = tests.filter(t => t.test_name.toLowerCase().includes(lowerName));
    if (matches.length > 0) return matches;

    // Try reverse partial match (test name contained in search term)
    matches = tests.filter(t => lowerName.includes(t.test_name.toLowerCase()));

    return matches;
}

/**
 * Get gender-specific value/range for a test
 * @param {Object} test - Test object
 * @param {string} patientGender - Patient gender ('Male' or 'Female')
 * @returns {Object} Test with correct gender-specific ranges
 */
export function getGenderSpecificTest(testName, patientGender) {
    const variations = getTestVariations(testName);
    
    if (variations.length === 0) {
        return null;
    }

    // Prefer exact gender match
    let match = variations.find(v => v.category === patientGender);
    
    // Fallback to 'Both' category
    if (!match) {
        match = variations.find(v => v.category === 'Both');
    }

    // Last resort: return first variation
    if (!match) {
        match = variations[0];
    }

    return match;
}

/**
 * Get a random normal sample value for a test
 * @param {Object} test - Test object
 * @returns {number} Random normal value
 */
export function getRandomNormalValue(test) {
    if (test.normal_samples && test.normal_samples.length > 0) {
        const randomIndex = Math.floor(Math.random() * test.normal_samples.length);
        return test.normal_samples[randomIndex];
    }
    
    // Fallback to midpoint of range
    return (test.min_value + test.max_value) / 2;
}

/**
 * Get all tests (with pagination)
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Tests per page
 * @returns {Object} { tests, total, page, totalPages }
 */
export function getAllTests(page = 1, pageSize = 50) {
    const tests = loadLabDatabase();
    const total = tests.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
        tests: tests.slice(start, end),
        total,
        page,
        totalPages,
        pageSize
    };
}

/**
 * Group tests by test name (combine gender variations)
 * @returns {Object} Tests grouped by name
 */
export function getGroupedTests() {
    const tests = loadLabDatabase();
    const grouped = {};

    tests.forEach(test => {
        if (!grouped[test.test_name]) {
            grouped[test.test_name] = {
                test_name: test.test_name,
                group: test.group,
                unit: test.unit,
                variations: []
            };
        }
        grouped[test.test_name].variations.push({
            category: test.category,
            min_value: test.min_value,
            max_value: test.max_value,
            normal_samples: test.normal_samples
        });
    });

    return grouped;
}

/**
 * Check if a value is within normal range
 * @param {number} value - Test value
 * @param {number} minValue - Minimum normal value
 * @param {number} maxValue - Maximum normal value
 * @returns {string} 'normal', 'high', or 'low'
 */
export function evaluateValue(value, minValue, maxValue) {
    if (value < minValue) return 'low';
    if (value > maxValue) return 'high';
    return 'normal';
}

/**
 * Get flag symbol for value status
 * @param {string} status - 'normal', 'high', 'low'
 * @returns {string} Flag symbol
 */
export function getValueFlag(status) {
    const flags = {
        'low': '↓',
        'high': '↑',
        'normal': ''
    };
    return flags[status] || '';
}

/**
 * Clear the cache to force reload
 */
export function clearCache() {
    labDatabaseCache = null;
    groupsCache = null;
}

/**
 * Save the lab database to file
 * @returns {boolean} Success status
 */
export function saveLabDatabase() {
    try {
        const labDbPath = path.resolve(__dirname, '../../Lab_database.txt');
        fs.writeFileSync(labDbPath, JSON.stringify(labDatabaseCache, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving Lab_database.txt:', error);
        return false;
    }
}

/**
 * Add a new lab test
 * @param {Object} test - Lab test object
 * @returns {Object} Result with success status
 */
export function addTest(test) {
    if (!test.test_name || !test.group || !test.unit) {
        return { success: false, error: 'test_name, group, and unit are required' };
    }

    const tests = loadLabDatabase();

    // Check for duplicate
    const exists = tests.find(t =>
        t.test_name === test.test_name && t.category === (test.category || 'Both')
    );

    if (exists) {
        return { success: false, error: 'Test with same name and category already exists' };
    }

    const newTest = {
        test_name: test.test_name,
        group: test.group,
        category: test.category || 'Both',
        min_value: parseFloat(test.min_value) || 0,
        max_value: parseFloat(test.max_value) || 0,
        unit: test.unit,
        normal_samples: test.normal_samples || []
    };

    labDatabaseCache.push(newTest);
    groupsCache = null; // Clear groups cache
    saveLabDatabase();

    return { success: true, test: newTest };
}

/**
 * Update an existing lab test
 * @param {string} testName - Test name to update
 * @param {string} category - Category (gender) of the test
 * @param {Object} updates - Fields to update
 * @returns {Object} Result with success status
 */
export function updateTest(testName, category, updates) {
    const tests = loadLabDatabase();

    const index = tests.findIndex(t =>
        t.test_name === testName && t.category === category
    );

    if (index === -1) {
        return { success: false, error: 'Test not found' };
    }

    // Update allowed fields
    if (updates.min_value !== undefined) tests[index].min_value = parseFloat(updates.min_value);
    if (updates.max_value !== undefined) tests[index].max_value = parseFloat(updates.max_value);
    if (updates.unit !== undefined) tests[index].unit = updates.unit;
    if (updates.group !== undefined) tests[index].group = updates.group;
    if (updates.normal_samples !== undefined) tests[index].normal_samples = updates.normal_samples;

    labDatabaseCache = tests;
    saveLabDatabase();

    return { success: true, test: tests[index] };
}

/**
 * Delete a lab test
 * @param {string} testName - Test name to delete
 * @param {string} category - Category (gender) of the test
 * @returns {Object} Result with success status
 */
export function deleteTest(testName, category) {
    const tests = loadLabDatabase();

    const index = tests.findIndex(t =>
        t.test_name === testName && t.category === category
    );

    if (index === -1) {
        return { success: false, error: 'Test not found' };
    }

    tests.splice(index, 1);
    labDatabaseCache = tests;
    groupsCache = null;
    saveLabDatabase();

    return { success: true, message: 'Test deleted' };
}

/**
 * Import lab tests from CSV data
 * @param {Array} csvData - Array of test objects from CSV
 * @param {boolean} overwrite - Whether to overwrite existing tests
 * @returns {Object} Import results
 */
export function importFromCSV(csvData, overwrite = false) {
    const tests = loadLabDatabase();
    const results = {
        added: 0,
        updated: 0,
        skipped: 0,
        errors: []
    };

    for (const row of csvData) {
        try {
            // Validate required fields
            if (!row.test_name || !row.group || !row.unit) {
                results.errors.push(`Missing required fields for: ${row.test_name || 'unknown'}`);
                results.skipped++;
                continue;
            }

            const category = row.category || 'Both';
            const existingIndex = tests.findIndex(t =>
                t.test_name === row.test_name && t.category === category
            );

            const newTest = {
                test_name: row.test_name.trim(),
                group: row.group.trim(),
                category: category,
                min_value: parseFloat(row.min_value) || 0,
                max_value: parseFloat(row.max_value) || 0,
                unit: row.unit.trim(),
                normal_samples: row.normal_samples ?
                    (Array.isArray(row.normal_samples) ? row.normal_samples :
                     row.normal_samples.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)))
                    : []
            };

            if (existingIndex !== -1) {
                if (overwrite) {
                    tests[existingIndex] = newTest;
                    results.updated++;
                } else {
                    results.skipped++;
                }
            } else {
                tests.push(newTest);
                results.added++;
            }
        } catch (error) {
            results.errors.push(`Error processing ${row.test_name}: ${error.message}`);
            results.skipped++;
        }
    }

    labDatabaseCache = tests;
    groupsCache = null;
    saveLabDatabase();

    return results;
}

/**
 * Get database stats
 * @returns {Object} Statistics about the database
 */
export function getDatabaseStats() {
    const tests = loadLabDatabase();
    const groups = getAllGroups();

    // Count by category
    const byCat = { Both: 0, Male: 0, Female: 0 };
    tests.forEach(t => {
        if (byCat[t.category] !== undefined) byCat[t.category]++;
    });

    return {
        totalTests: tests.length,
        totalGroups: groups.length,
        byCategory: byCat,
        groups: groups
    };
}

// Initialize cache on module load
loadLabDatabase();

export default {
    loadLabDatabase,
    searchTests,
    getTestsByGroup,
    getAllGroups,
    getTestByNameAndGender,
    getTestVariations,
    getGenderSpecificTest,
    getRandomNormalValue,
    getAllTests,
    getGroupedTests,
    evaluateValue,
    getValueFlag,
    clearCache,
    saveLabDatabase,
    addTest,
    updateTest,
    deleteTest,
    importFromCSV,
    getDatabaseStats
};
