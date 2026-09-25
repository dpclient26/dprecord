export async function onRequest(context) {
  const { env } = context;

  if (!env.DB) {
    return Response.json({ 
      error: 'DB binding missing. Check Cloudflare Settings → Functions → D1 bindings.' 
    }, { status: 500 });
  }

  try {
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM requests"
    ).all();

    return Response.json({
      status: 'D1 connected successfully!',
      rowCount: results[0].count,
      database: 'deg-data-purity-db'
    });
  } catch (error) {
    return Response.json({
      error: 'D1 query failed: ' + error.message
    }, { status: 500 });
  }
}