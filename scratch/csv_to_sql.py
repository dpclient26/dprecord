"""
CSV to SQL Converter for dprecord D1 Database
Converts historical_records.csv -> import_records.sql

Usage:
    cd d:\clientRepo\dprecord
    python scratch\csv_to_sql.py

Input:  d:\clientRepo\dprecord\historical_records.csv
Output: d:\clientRepo\dprecord\scratch\import_records.sql
"""

import csv
import os
import re
from datetime import datetime

# --- Configuration ---
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(PROJECT_ROOT, "historical_records.csv")
SQL_PATH = os.path.join(PROJECT_ROOT, "scratch", "import_records.sql")

# Column mapping: CSV header -> DB column
COLUMN_MAP = {
    "Reference Number/Ticket Number": "ref_id",
    "Requested Department": "requested_dept",
    "Request Date": "request_date",
    "Letter / Email Reference": "letter_ref",
    "Action Taken By": "action_by",
    "Problem Statement / Objective": "problem",
    "Datasets Used": "datasets",
    "Date for Data Dump": "data_dump_date",
    "Received Count": "received_count",
    "Result Shared Mode": "shared_mode",
    "Analysis Outcome": "analysis",
    "Status": "status",
    "Savings": "savings",
    "Timestamp": "timestamp",
}

DB_COLUMNS = [
    "ref_id", "requested_dept", "request_date", "letter_ref",
    "action_by", "problem", "datasets", "data_dump_date",
    "received_count", "shared_mode", "analysis", "status",
    "savings", "timestamp"
]


def normalize_date(value):
    """Try to convert various date formats to YYYY-MM-DD."""
    if not value or value.strip() in ("", "-", "N/A"):
        return ""
    value = value.strip()
    # Already in YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return value
    # Try common formats
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Try Excel serial date number
    try:
        serial = int(value)
        if 40000 < serial < 50000:
            from datetime import timedelta
            base = datetime(1899, 12, 30)
            return (base + timedelta(days=serial)).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        pass
    return value  # Return as-is if nothing works


def escape_sql(value):
    """Escape single quotes for SQL strings."""
    if value is None:
        return ""
    return str(value).replace("'", "''")


def main():
    if not os.path.exists(CSV_PATH):
        print(f"ERROR: CSV file not found at: {CSV_PATH}")
        print(f"\nPlease do the following:")
        print(f"  1. Open your Excel file with the 48 historical records")
        print(f"  2. File -> Save As -> CSV UTF-8 (Comma delimited) (*.csv)")
        print(f"  3. Save it as: {CSV_PATH}")
        print(f"\nExpected CSV columns:")
        for col in COLUMN_MAP.keys():
            print(f"  - {col}")
        return

    rows = []
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        csv_headers = reader.fieldnames
        print(f"Found CSV columns: {csv_headers}")
        print()

        # Build a flexible header mapping (case-insensitive, trimmed)
        header_map = {}
        for csv_col in csv_headers:
            clean = csv_col.strip()
            for expected, db_col in COLUMN_MAP.items():
                if clean.lower() == expected.lower():
                    header_map[csv_col] = db_col
                    break

        mapped_db_cols = set(header_map.values())
        required = {"ref_id", "requested_dept", "action_by", "status"}
        missing_required = required - mapped_db_cols
        if missing_required:
            friendly = {v: k for k, v in COLUMN_MAP.items()}
            print(f"ERROR: Missing required columns in CSV:")
            for col in missing_required:
                print(f"  - {friendly.get(col, col)}")
            return

        print(f"Mapped {len(header_map)} columns successfully:")
        for csv_col, db_col in header_map.items():
            print(f"  '{csv_col}' -> {db_col}")

        unmapped = [c for c in csv_headers if c not in header_map]
        if unmapped:
            print(f"\nWARNING: Unmapped CSV columns (will be skipped): {unmapped}")

        print()

        for i, row in enumerate(reader, start=2):  # start=2 because row 1 is header
            record = {}
            for csv_col, db_col in header_map.items():
                val = (row.get(csv_col) or "").strip()
                # Normalize date fields
                if db_col in ("request_date", "data_dump_date"):
                    val = normalize_date(val)
                record[db_col] = val

            # Generate timestamp if not provided
            if not record.get("timestamp"):
                record["timestamp"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S+05:30")

            # Validate ref_id exists
            if not record.get("ref_id"):
                print(f"WARNING: Skipping CSV row {i} — empty ref_id")
                continue

            rows.append(record)

    if not rows:
        print("ERROR: No valid rows found in CSV.")
        return

    # Sort by ref_id to insert in order
    rows.sort(key=lambda r: r.get("ref_id", ""))

    # Generate SQL
    lines = [
        "-- =============================================",
        "-- Historical Records Import (20260001-20260048)",
        f"-- Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S IST')}",
        f"-- Total Records: {len(rows)}",
        "-- =============================================",
        "",
    ]

    col_list = ", ".join(DB_COLUMNS)

    for record in rows:
        values = []
        for col in DB_COLUMNS:
            val = escape_sql(record.get(col, ""))
            values.append(f"'{val}'")
        val_list = ", ".join(values)
        lines.append(f"INSERT INTO requests ({col_list}) VALUES ({val_list});")

    lines.append("")
    lines.append(f"-- Done. {len(rows)} records to insert.")

    with open(SQL_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"SUCCESS: Generated {len(rows)} INSERT statements")
    print(f"SQL file saved to: {SQL_PATH}")
    print()
    print("=" * 55)
    print("NEXT STEPS:")
    print("=" * 55)
    print()
    print("Option A — Wrangler CLI (recommended):")
    print(f'  wrangler d1 execute <YOUR_DB_NAME> --file=scratch\\import_records.sql --remote')
    print()
    print("Option B — Cloudflare Dashboard:")
    print(f"  1. Open Cloudflare Dashboard -> Workers & Pages -> D1 -> Your DB")
    print(f"  2. Go to the Console tab")
    print(f"  3. Copy-paste the contents of: {SQL_PATH}")
    print(f"  4. Click Execute")
    print()
    print("After importing, verify with:")
    print(f'  wrangler d1 execute <YOUR_DB_NAME> --command="SELECT COUNT(*) FROM requests" --remote')


if __name__ == "__main__":
    main()

