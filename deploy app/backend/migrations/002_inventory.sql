CREATE TABLE dirac.inventory_stock (
    pack_key TEXT PRIMARY KEY,
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dirac.inventory_stock ENABLE ROW LEVEL SECURITY;
