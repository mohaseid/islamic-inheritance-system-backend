-- 002_insert_fiqh_data.sql

-- This script inserts the necessary core inheritance data into HeirTypes and FiqhRules.

-- 1. Insert Core Heir Types (HeirTypes Table)
-- Only insert if the table is empty to prevent primary key conflicts

INSERT INTO HeirTypes (name_en, name_ar, classification, default_share) VALUES 
('Husband', 'زوج', 'As-hab al-Faraid', 0.5000),      -- 1/2 (No descendants)
('Wife', 'زوجة', 'As-hab al-Faraid', 0.2500),       -- 1/4 (No descendants)
('Spouse (Wife)', 'زوجة', 'As-hab al-Faraid', 0.2500), -- Critical match for frontend
('Mother', 'أم', 'As-hab al-Faraid', 0.3333),       -- 1/3 (No children or siblings)
('Father', 'أب', 'As-hab al-Faraid', 0.1667),       -- 1/6 (If there is a descendant)
('Daughter', 'بنت', 'As-hab al-Faraid', 0.5000),    -- 1/2 (Single daughter, no son)
('Full Sister', 'أخت شقيقة', 'As-hab al-Faraid', 0.5000),
('Son', 'ابن', 'Asaba', NULL), 
('Paternal Grandfather', 'جد أب', 'Asaba', NULL),
('Full Brother', 'أخ شقيق', 'Asaba', NULL)
ON CONFLICT DO NOTHING;


-- 2. Insert Inheritance Rules (FiqhRules Table)
-- Use a CTE (Common Table Expression) to safely retrieve IDs for linking rules.

WITH HeirIDs AS (
    SELECT heir_type_id, name_en FROM HeirTypes
)

-- Rule: Spouse (Wife) Reduction: 1/4 (0.25) to 1/8 (0.125) due to descendant (Son)
INSERT INTO FiqhRules (heir_type_id, condition_heir_id, condition_type, reduction_factor, description_en)
SELECT 
    (SELECT heir_type_id FROM HeirIDs WHERE name_en = 'Spouse (Wife)'),
    (SELECT heir_type_id FROM HeirIDs WHERE name_en = 'Son'),
    'Reduction', 
    0.1250, 
    'Wife/Spouse share reduced from 1/4 to 1/8 due to the presence of a descendant (Son).'
ON CONFLICT DO NOTHING;

-- Rule: Mother Reduction: 1/3 (0.3333) to 1/6 (0.1667) due to descendant (Son)
INSERT INTO FiqhRules (heir_type_id, condition_heir_id, condition_type, reduction_factor, description_en)
SELECT 
    (SELECT heir_type_id FROM HeirIDs WHERE name_en = 'Mother'),
    (SELECT heir_type_id FROM HeirIDs WHERE name_en = 'Son'),
    'Reduction', 
    0.1667, 
    'Mother''s share reduced from 1/3 to 1/6 due to the presence of a descendant.'
ON CONFLICT DO NOTHING;

-- Rule: Full Brother Exclusion: Excluded by Son
INSERT INTO FiqhRules (heir_type_id, condition_heir_id, condition_type, reduction_factor, description_en)
SELECT 
    (SELECT heir_type_id FROM HeirIDs WHERE name_en = 'Full Brother'),
    (SELECT heir_type_id FROM HeirIDs WHERE name_en = 'Son'),
    'Exclusion', 
    NULL,
    'Excluded by a male descendant (Son).'
ON CONFLICT DO NOTHING;