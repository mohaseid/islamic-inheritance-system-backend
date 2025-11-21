-- 1. HeirTypes Table
CREATE TABLE IF NOT EXISTS HeirTypes (
    heir_type_id SERIAL PRIMARY KEY,
    name_en VARCHAR(50) NOT NULL,
    name_ar VARCHAR(50),
    classification VARCHAR(50) NOT NULL,
    default_share NUMERIC(5,4)
);

-- 2. FiqhRules Table
CREATE TABLE IF NOT EXISTS FiqhRules (
    rule_id SERIAL PRIMARY KEY,
    heir_type_id INT REFERENCES HeirTypes(heir_type_id) ON DELETE CASCADE,
    condition_heir_id INT REFERENCES HeirTypes(heir_type_id) ON DELETE SET NULL,
    condition_type VARCHAR(20) NOT NULL, 
    reduction_factor NUMERIC(5,4),
    description_en TEXT
);

-- 3. Glossary Table
CREATE TABLE IF NOT EXISTS Glossary (
    term_id SERIAL PRIMARY KEY,
    term_en VARCHAR(100) NOT NULL,
    term_ar VARCHAR(100),
    definition_en TEXT NOT NULL,
    source_fiqh VARCHAR(50)
);