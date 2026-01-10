import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for the loaded lab database
let labDatabaseCache = null;
let groupsCache = null;

/**
 * Load and parse Lab_database.txt
 * @returns {Array} Array of lab test objects
 */
export function loadLabDatabase() {
    if (labDatabaseCache) {
        return labDatabaseCache;
    }

    try {
        const labDbPath = path.resolve(__dirname, '../../Lab_database.txt');
        const data = fs.readFileSync(labDbPath, 'utf8');
        labDatabaseCache = JSON.parse(data);
        console.log(`Loaded ${labDatabaseCache.length} lab tests from database`);
        return labDatabaseCache;
    } catch (error) {
        console.error('Error loading lab database:', error);
        return [];
    }
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
    
    // Simple fuzzy search: match partial test names
    const results = tests.filter(test => 
        test.test_name.toLowerCase().includes(searchTerm)
    );

    // Group by test name to show gender variations together
    const grouped = {};
    results.forEach(test => {
        if (!grouped[test.test_name]) {
            grouped[test.test_name] = [];
        }
        grouped[test.test_name].push(test);
    });

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
    return tests.filter(t => t.test_name === testName);
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
    getValueFlag
};
