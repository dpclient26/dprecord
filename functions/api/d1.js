// functions/api/d1.js
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // Sanity check: is the D1 binding present?
    if (!env.DB) {
        return Response.json(
            { error: 'DB binding missing. Check Cloudflare Settings → Functions → D1 bindings.' },
            { status: 500 }
        );
    }

    try {
        // ================================
        // GET: Fetch all records
        // ================================
        if (request.method === 'GET' && action === 'get') {
            const { results } = await env.DB.prepare(
                "SELECT * FROM requests ORDER BY timestamp DESC"
            ).all();
            return Response.json(results);
        }

        // ================================
        // POST: Add or Update
        // ================================
        if (request.method === 'POST') {
            const data = await request.json();

            // ----- ADD NEW RECORD -----
            if (action === 'add') {
                // Generate ref_id: current year + 4-digit number starting from 0049
                const year = new Date().getFullYear().toString();
                const STARTING_NUMBER = 48;
                const countResult = await env.DB.prepare(
                    "SELECT COUNT(*) as c FROM requests WHERE ref_id LIKE ?"
                ).bind(year + '%').first();

                const nextNum = (countResult.c + STARTING_NUMBER + 1).toString().padStart(4, '0');
                const newRefId = year + nextNum;

                await env.DB.prepare(
                    `INSERT INTO requests 
          (ref_id, requested_dept, request_date, letter_ref, action_by, problem,
           datasets, data_dump_date, received_count, shared_mode,
           analysis, action_taken, status, savings)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    newRefId,
                    data['Requested Department'] || '',
                    data['Request Date'] || '',
                    data['Letter / Email Reference'] || '',
                    data['Action Taken By'] || '',
                    data['Problem Statement / Objective'] || '',
                    data['Datasets Used'] || '',
                    data['Date for Data Dump'] || '',
                    data['Received Count'] || '',
                    data['Result Shared Mode'] || '',
                    data['Analysis Outcome'] || '',
                    data['Action Taken'] || '',
                    data['Status'] || 'Pending',
                    data['Savings'] || '',
                ).run();

                return Response.json({ result: 'success', action: 'added', id: newRefId });
            }

            // ----- UPDATE EXISTING RECORD -----
            if (action === 'update') {
                const originalId = data['originalId'];
                if (!originalId) {
                    return Response.json({ error: 'Missing originalId for update.' }, { status: 400 });
                }

                await env.DB.prepare(
                    `UPDATE requests SET
            requested_dept = ?, request_date = ?, letter_ref = ?, action_by = ?,
            problem = ?, datasets = ?, data_dump_date = ?, received_count = ?,
            shared_mode = ?, analysis = ?, action_taken = ?, status = ?, savings = ?
          WHERE ref_id = ?`
                ).bind(
                    data['Requested Department'] || '',
                    data['Request Date'] || '',
                    data['Letter / Email Reference'] || '',
                    data['Action Taken By'] || '',
                    data['Problem Statement / Objective'] || '',
                    data['Datasets Used'] || '',
                    data['Date for Data Dump'] || '',
                    data['Received Count'] || '',
                    data['Result Shared Mode'] || '',
                    data['Analysis Outcome'] || '',
                    data['Action Taken'] || '',
                    data['Status'] || 'Pending',
                    data['Savings'] || '',
                    originalId
                ).run();

                return Response.json({ result: 'success', action: 'updated' });
            }
        }

        return Response.json({ error: 'Invalid action or method.' }, { status: 400 });

    } catch (error) {
        console.error("D1 proxy error:", error);
        return Response.json({ error: 'Server error: ' + error.message }, { status: 500 });
    }
}