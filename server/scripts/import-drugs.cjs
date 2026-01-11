#!/usr/bin/env node
/**
 * Import drugs from local JSONL file
 * Usage: node server/scripts/import-drugs.cjs
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const JSONL_PATH = path.join(__dirname, 'drugs.jsonl');

async function readDrugsFromFile() {
    console.log('Reading drugs from:', JSONL_PATH);

    const drugs = [];
    const fileStream = fs.createReadStream(JSONL_PATH);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (line.trim()) {
            try {
                const drug = JSON.parse(line);
                drugs.push({
                    name: drug.medicine_name,
                    uses: drug.uses || [],
                    side_effects: drug.side_effects || [],
                    description: drug.description || ''
                });
            } catch (err) {
                // Skip malformed lines
            }
        }
    }

    return drugs;
}

async function importToDatabase(drugs) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);

        console.log(`\nImporting ${drugs.length} drugs to database...`);

        let inserted = 0;
        let skipped = 0;

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const stmt = db.prepare(
                `INSERT OR IGNORE INTO medications (generic_name, indications, side_effects, category) VALUES (?, ?, ?, ?)`
            );

            for (const drug of drugs) {
                stmt.run(
                    drug.name,
                    JSON.stringify(drug.uses),
                    JSON.stringify(drug.side_effects),
                    'General',
                    function(err) {
                        if (!err && this.changes > 0) inserted++;
                        else skipped++;
                    }
                );
            }

            stmt.finalize();

            db.run('COMMIT', (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`\n✓ Import complete!`);
                    console.log(`  Inserted: ${inserted}`);
                    console.log(`  Skipped (duplicates): ${skipped}`);

                    db.get('SELECT COUNT(*) as count FROM medications', (err, row) => {
                        if (row) {
                            console.log(`  Total medications in database: ${row.count}`);
                        }
                        db.close();
                        resolve({ inserted, skipped });
                    });
                }
            });
        });
    });
}

async function main() {
    console.log('=== Drug Database Import ===\n');

    if (!fs.existsSync(JSONL_PATH)) {
        console.error('Error: drugs.jsonl not found at', JSONL_PATH);
        console.log('Download it first from HuggingFace.');
        process.exit(1);
    }

    try {
        const drugs = await readDrugsFromFile();

        if (drugs.length === 0) {
            console.log('No drugs found in file. Exiting.');
            return;
        }

        console.log(`Read ${drugs.length} drugs from file.`);
        console.log('Sample:', drugs[0].name);

        await importToDatabase(drugs);

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
