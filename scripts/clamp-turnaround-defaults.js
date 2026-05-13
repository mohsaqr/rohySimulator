#!/usr/bin/env node
// Clamp lab + radiology turnaround defaults into the 1–5 minute band the
// simulator uses. Re-run after editing the source JSONs.
//
// Rules locked with the user 2026-05-13:
//   Radiology by modality:
//     X-Ray, Mammography, DEXA          → 1
//     Ultrasound, Fluoroscopy           → 2
//     CT                                 → 3
//     MRI, Nuclear Medicine             → 4
//     Cardiac (echo, stress) + any
//        current value ≥ 240            → 5
//   Labs by group:
//     stat (CBC, Diff, BMP, ABG,        → 1
//       cardiac, coags, renal,
//       glucose)
//     routine chemistry (LFT, lipids,   → 3
//       thyroid, hormones, vitamins,
//       iron, A1c, BNP-ish, pancreatic,
//       adrenal, pituitary, parathyroid,
//       hemolysis, cv-risk, metabolic,
//       urinalysis, inflammatory)
//     send-out / micro / special        → 5
//       (body fluids, CSF, autoimmune,
//       tumour markers, drug levels,
//       toxicology, trace elements,
//       thrombophilia, immunoglobulins)
//
// Authors who deliberately need a longer wait on a specific test can
// override per-case in the case wizard; this script only seeds the
// default value.
//
// Usage: node scripts/clamp-turnaround-defaults.js
//        node scripts/clamp-turnaround-defaults.js --check   (no writes)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LAB_PATH = path.join(ROOT, 'Lab_database.json');
const RAD_PATH = path.join(ROOT, 'server/data/radiology_database.json');

const LAB_BUCKETS = {
    1: new Set([
        'Hematology (CBC)',
        'Hematology (Differential)',
        'Basic Metabolic Panel',
        'Blood Gases',
        'Cardiac Markers',
        'Coagulation',
        'Renal Function',
        'Diabetes',
    ]),
    3: new Set([
        'Liver Function',
        'Lipid Panel',
        'Thyroid Function',
        'Reproductive Hormones',
        'Iron Studies',
        'Vitamins',
        'Inflammatory Markers',
        'Metabolic',
        'Urinalysis',
        'Pancreatic',
        'Adrenal Function',
        'Pituitary',
        'Parathyroid',
        'Hemolysis Markers',
        'Cardiovascular Risk',
    ]),
    5: new Set([
        'Body Fluids',
        'Cerebrospinal Fluid',
        'Autoimmune',
        'Tumor Markers',
        'Drug Levels',
        'Toxicology',
        'Trace Elements',
        'Thrombophilia',
        'Immunoglobulins',
    ]),
};

const RAD_BUCKETS = {
    1: new Set(['X-Ray', 'Mammography', 'DEXA']),
    2: new Set(['Ultrasound', 'Fluoroscopy']),
    3: new Set(['CT']),
    4: new Set(['MRI', 'Nuclear Medicine']),
    5: new Set(['Cardiac']),
};

function bucketFor(buckets, key) {
    for (const [minutes, members] of Object.entries(buckets)) {
        if (members.has(key)) return Number(minutes);
    }
    return null;
}

function clampLabs(rows) {
    let changed = 0;
    const unknownGroups = new Set();
    for (const row of rows) {
        const target = bucketFor(LAB_BUCKETS, row.group);
        if (target === null) {
            unknownGroups.add(row.group);
            continue;
        }
        if (row.turnaround_minutes !== target) {
            row.turnaround_minutes = target;
            changed++;
        }
    }
    return { changed, unknownGroups: [...unknownGroups] };
}

function clampRadiology(studies) {
    let changed = 0;
    const unknownModalities = new Set();
    for (const study of studies) {
        let target = bucketFor(RAD_BUCKETS, study.modality);
        // Catch-all: anything previously >= 240 (4+ hours) goes to 5 even if
        // its modality bucket is shorter — these are send-out / specialty
        // studies (myelography, cultures) and shouldn't slip into a fast
        // bucket if the modality string is mislabelled.
        if (study.turnaround_minutes >= 240) target = 5;
        if (target === null) {
            unknownModalities.add(study.modality);
            continue;
        }
        if (study.turnaround_minutes !== target) {
            study.turnaround_minutes = target;
            changed++;
        }
    }
    return { changed, unknownModalities: [...unknownModalities] };
}

const check = process.argv.includes('--check');

const labs = JSON.parse(fs.readFileSync(LAB_PATH, 'utf8'));
const radiology = JSON.parse(fs.readFileSync(RAD_PATH, 'utf8'));

const labResult = clampLabs(labs);
const radResult = clampRadiology(radiology.studies);

console.log(`labs        — updated ${labResult.changed} / ${labs.length}`);
if (labResult.unknownGroups.length) {
    console.warn('  unknown lab groups (no bucket):', labResult.unknownGroups);
    process.exitCode = 1;
}
console.log(`radiology   — updated ${radResult.changed} / ${radiology.studies.length}`);
if (radResult.unknownModalities.length) {
    console.warn('  unknown modalities (no bucket):', radResult.unknownModalities);
    process.exitCode = 1;
}

if (check) {
    console.log('(--check: not writing files)');
} else {
    fs.writeFileSync(LAB_PATH, JSON.stringify(labs, null, 2) + '\n');
    fs.writeFileSync(RAD_PATH, JSON.stringify(radiology, null, 2) + '\n');
    console.log('wrote Lab_database.json + server/data/radiology_database.json');
}
