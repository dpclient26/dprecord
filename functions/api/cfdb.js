export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    let action = url.searchParams.get('action');

    // 🔒 AUTH CHECK
    const loggedInUser = request.headers.get('X-Logged-In-User') || '';
    const validUser = env.ADMIN_USER || '';

    if (!loggedInUser || loggedInUser !== validUser) {
        return Response.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    try {
        // ================================
        // GET: Fetch all records
        // ================================
        if (request.method === 'GET' && action === 'get') {
            const { results } = await env.DB.prepare(
                "SELECT * FROM requests ORDER BY id DESC"
            ).all();

            const mapped = results.map(r => ({
                'Reference Number/Ticket Number': r.ref_id,
                'Requested Department': r.requested_dept,
                'Request Date': r.request_date,
                'Letter / Email Reference': r.letter_ref,
                'Action Taken By': r.action_by,
                'Problem Statement / Objective': r.problem,
                'Datasets Used': r.datasets,
                'Date for Data Dump': r.data_dump_date,
                'Received Count': r.received_count,
                'Result Shared Mode': r.shared_mode,
                'Analysis Outcome': r.analysis,
                'Status': r.status,
                'Savings': r.savings,
                'Timestamp': r.timestamp
            }));

            return Response.json(mapped);
        }

        // ================================
        // POST: Add or Update
        // ================================
        if (request.method === 'POST') {
            const bodyText = await request.text();
            const data = new URLSearchParams(bodyText);
            const get = (key) => data.get(key) || '';

            if (!action) {
                action = data.get('action');
            }

            // ----- ADD NEW RECORD -----
            if (action === 'add') {
                const year = new Date().getFullYear().toString();
                const STARTING_NUMBER = 48;

                const maxResult = await env.DB.prepare(
                    "SELECT ref_id FROM requests WHERE ref_id LIKE ? ORDER BY ref_id DESC LIMIT 1"
                ).bind(year + '%').first();

                let nextCount = STARTING_NUMBER + 1;
                if (maxResult && maxResult.ref_id) {
                    const lastNum = parseInt(maxResult.ref_id.substring(4), 10);
                    if (!isNaN(lastNum)) nextCount = lastNum + 1;
                }

                const newRefId = year + String(nextCount).padStart(4, '0');

                await env.DB.prepare(
                    `INSERT INTO requests 
                    (ref_id, requested_dept, request_date, letter_ref, action_by, problem,
                     datasets, data_dump_date, received_count, shared_mode,
                     analysis, status, savings)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    newRefId,
                    get('Requested Department'),
                    get('Request Date'),
                    get('Letter / Email Reference'),
                    get('Action Taken By'),
                    get('Problem Statement / Objective'),
                    get('Datasets Used'),
                    get('Date for Data Dump'),
                    get('Received Count'),
                    get('Result Shared Mode'),
                    get('Analysis Outcome'),
                    get('Status') || 'Pending',
                    get('Savings')
                ).run();

                return Response.json({ result: 'success', action: 'added', id: newRefId });
            }

            // ----- UPDATE EXISTING RECORD -----
            if (action === 'update') {
                const originalId = get('originalId');
                if (!originalId) {
                    return Response.json({ error: 'Missing originalId for update.' }, { status: 400 });
                }

                await env.DB.prepare(
                    `UPDATE requests SET
                    requested_dept = ?, request_date = ?, letter_ref = ?, action_by = ?,
                    problem = ?, datasets = ?, data_dump_date = ?, received_count = ?,
                    shared_mode = ?, analysis = ?, status = ?, savings = ?
                    WHERE ref_id = ?`
                ).bind(
                    get('Requested Department'),
                    get('Request Date'),
                    get('Letter / Email Reference'),
                    get('Action Taken By'),
                    get('Problem Statement / Objective'),
                    get('Datasets Used'),
                    get('Date for Data Dump'),
                    get('Received Count'),
                    get('Result Shared Mode'),
                    get('Analysis Outcome'),
                    get('Status') || 'Pending',
                    get('Savings'),
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