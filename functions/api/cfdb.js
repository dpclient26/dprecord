import {
    verifyToken,
    toIST,
    nowIST,
    getClientIP,
    logAudit,
    secureJson
} from '../_lib/security.js';

function mapRecord(r) {
    return {
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
        'Timestamp': toIST(r.timestamp)
    };
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    let action = url.searchParams.get('action');

    // CSRF & Content-Type check for state-changing requests
    if (request.method === 'POST') {
        const origin = request.headers.get('Origin');
        if (!origin || new URL(origin).host !== url.host) {
            return Response.json({ error: 'Forbidden.' }, { status: 403 });
        }

        const contentType = request.headers.get('Content-Type') || '';
        if (!contentType.includes('application/x-www-form-urlencoded')) {
            return Response.json({ error: 'Invalid content type.' }, { status: 415 });
        }
    }

    // Verify HMAC-signed token (allows both 'admin' and 'user' roles)
    const authHeader = request.headers.get('Authorization');
    const tokenPayload = await verifyToken(authHeader, env);

    if (!tokenPayload || !tokenPayload.user) {
        return secureJson({ error: 'Unauthorized. Please log in.' }, 401);
    }

    const isAdmin = tokenPayload.role === 'admin';
    const userDisplayName = (tokenPayload.displayName || tokenPayload.user || '').trim();
    const clientIP = getClientIP(request);

    try {
        // ================================
        // GET: Fetch all records
        // ================================
        if (request.method === 'GET' && action === 'get') {
            const { results } = await env.DB.prepare(
                'SELECT * FROM requests ORDER BY id DESC'
            ).all();

            return secureJson(results.map(mapRecord));
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
                'SELECT * FROM requests WHERE ref_id = ?'
            ).bind(id).first();

            if (!r) {
                return Response.json({ error: 'Record not found.' }, { status: 404 });
            }

            return secureJson(mapRecord(r));
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

            const VALID_STATUSES = ['Pending', 'In Progress', 'Completed'];
            const MAX_FIELD_LENGTH = 2000;

            const status = get('Status') || 'Pending';
            if (!VALID_STATUSES.includes(status)) {
                return Response.json({ error: 'Invalid status value.' }, { status: 400 });
            }

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
                // Non-admin users can only create records under their own displayName
                const actionBy = isAdmin ? get('Action Taken By') : userDisplayName;

                const year = new Date().getFullYear().toString();
                const STARTING_NUMBER = 48;

                const maxResult = await env.DB.prepare(
                    'SELECT ref_id FROM requests WHERE ref_id LIKE ? ORDER BY LENGTH(ref_id) DESC, ref_id DESC LIMIT 1'
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
                     analysis, status, savings, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    newRefId,
                    get('Requested Department'),
                    get('Request Date'),
                    get('Letter / Email Reference'),
                    actionBy,
                    get('Problem Statement / Objective'),
                    get('Datasets Used'),
                    get('Date for Data Dump'),
                    get('Received Count'),
                    get('Result Shared Mode'),
                    get('Analysis Outcome'),
                    status,
                    get('Savings'),
                    nowIST()
                ).run();

                await logAudit(env, {
                    userId: tokenPayload.userId || 0,
                    username: tokenPayload.user,
                    action: 'add_record',
                    targetType: 'record',
                    targetId: newRefId,
                    details: {
                        department: get('Requested Department'),
                        action_by: actionBy,
                        status
                    },
                    ipAddress: clientIP
                });

                return secureJson({ result: 'success', action: 'added', id: newRefId });
            }

            // ----- UPDATE EXISTING RECORD -----
            if (action === 'update') {
                const originalId = get('originalId');
                if (!originalId) {
                    return Response.json({ error: 'Missing originalId for update.' }, { status: 400 });
                }

                const existing = await env.DB.prepare(
                    'SELECT action_by FROM requests WHERE ref_id = ?'
                ).bind(originalId).first();

                if (!existing) {
                    return Response.json({ error: 'Record not found.' }, { status: 404 });
                }

                // Server-side ownership check for non-admin users
                if (!isAdmin) {
                    const recordOwner = (existing.action_by || '').trim().toLowerCase();
                    const userLower = (tokenPayload.user || '').trim().toLowerCase();
                    if (recordOwner !== userDisplayName.toLowerCase() && recordOwner !== userLower) {
                        return secureJson(
                            { error: 'Forbidden. You can only edit your own records.' },
                            403
                        );
                    }
                }

                // Non-admins cannot reassign Action Taken By to another user
                const actionBy = isAdmin ? get('Action Taken By') : existing.action_by;

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
                    actionBy,
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

                await logAudit(env, {
                    userId: tokenPayload.userId || 0,
                    username: tokenPayload.user,
                    action: 'update_record',
                    targetType: 'record',
                    targetId: originalId,
                    details: {
                        department: get('Requested Department'),
                        action_by: actionBy,
                        status
                    },
                    ipAddress: clientIP
                });

                return secureJson({ result: 'success', action: 'updated' });
            }
        }

        return Response.json({ error: 'Invalid action or method.' }, { status: 400 });
    } catch (error) {
        console.error('D1 proxy error:', error);
        return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
    }
}
