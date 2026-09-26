// Token verification helper — validates HMAC-signed tokens from auth.js
async function verifyToken(authHeader, env) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    try {
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        const [payloadB64, sigB64] = parts;
        if (!env.AUTH_SECRET) return null;

        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(env.AUTH_SECRET),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const sigBuffer = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
        const valid = await crypto.subtle.verify(
            'HMAC', key, sigBuffer, new TextEncoder().encode(payloadB64)
        );

        if (!valid) return null;

        const payload = JSON.parse(atob(payloadB64));

        // Token expires after 24 hours
        if (Date.now() - payload.iat > 24 * 60 * 60 * 1000) return null;

        return payload;
    } catch {
        return null;
    }
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    let action = url.searchParams.get('action');

    // 🔒 CSRF CHECK — validate Origin header for state-changing requests
    if (request.method === 'POST') {
        const origin = request.headers.get('Origin');
        const requestUrl = new URL(request.url);
        if (origin && new URL(origin).host !== requestUrl.host) {
            return Response.json({ error: 'Forbidden.' }, { status: 403 });
        }
    }

    // 🔒 AUTH CHECK — verify HMAC-signed token
    const authHeader = request.headers.get('Authorization');
    const tokenPayload = await verifyToken(authHeader, env);

    if (!tokenPayload || tokenPayload.user !== env.ADMIN_USER) {
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
        // GET: Fetch single record by ID
        // ================================
        if (request.method === 'GET' && action === 'get_one') {
            const id = url.searchParams.get('id');
            if (!id) {
                return Response.json({ error: 'Missing id parameter.' }, { status: 400 });
            }

            const r = await env.DB.prepare(
                "SELECT * FROM requests WHERE ref_id = ?"
            ).bind(id).first();

            if (!r) {
                return Response.json({ error: 'Record not found.' }, { status: 404 });
            }

            return Response.json({
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
            });
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

            // Server-side validation
            const VALID_STATUSES = ['Pending', 'In Progress', 'Completed'];
            const MAX_FIELD_LENGTH = 2000;

            const status = get('Status') || 'Pending';
            if (!VALID_STATUSES.includes(status)) {
                return Response.json({ error: 'Invalid status value.' }, { status: 400 });
            }

            // Validate field lengths
            const fieldsToCheck = [
                'Requested Department', 'Letter / Email Reference', 'Action Taken By',
                'Problem Statement / Objective', 'Datasets Used', 'Received Count',
                'Result Shared Mode', 'Analysis Outcome', 'Savings'
            ];
            for (const field of fieldsToCheck) {
                if (get(field).length > MAX_FIELD_LENGTH) {
                    return Response.json({ error: `Field "${field}" exceeds maximum length.` }, { status: 400 });
                }
            }

            // ----- ADD NEW RECORD -----
            if (action === 'add') {
                const year = new Date().getFullYear().toString();
                const STARTING_NUMBER = 48;

                const maxResult = await env.DB.prepare(
                    "SELECT ref_id FROM requests WHERE ref_id LIKE ? ORDER BY LENGTH(ref_id) DESC, ref_id DESC LIMIT 1"
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
                    status,
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
                    status,
                    get('Savings'),
                    originalId
                ).run();

                return Response.json({ result: 'success', action: 'updated' });
            }
        }

        return Response.json({ error: 'Invalid action or method.' }, { status: 400 });

    } catch (error) {
        console.error("D1 proxy error:", error);
        return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
    }
}