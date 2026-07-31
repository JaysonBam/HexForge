import {
  corsHeaders,
  handleOptions,
  jsonResponse,
  verifyActiveUser
} from '../_shared/security.ts';
import {
  consumeOperationLimit,
  getAccessToken,
  recordSecurityEvent
} from '../_shared/gmail.ts';
import { classifyGmailProxyRequest } from '../_shared/gmailProxyPolicy.ts';

const readSafeGoogleError = async (response: Response) => {
  const payload = await response.json().catch(() => ({})) as {
    error?: { status?: string; message?: string };
  };
  return {
    status: payload.error?.status || 'GOOGLE_API_ERROR',
    message: response.status === 403
      ? 'Gmail did not grant the required permission.'
      : response.status === 404
        ? 'The requested Gmail resource was not found.'
        : 'The Gmail request could not be completed.'
  };
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const user = await verifyActiveUser(request);
  if (!user) return jsonResponse(request, { error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  const allowed = classifyGmailProxyRequest(path, request.method);
  if (!allowed) {
    await recordSecurityEvent(user.id, 'gmail_proxy_request_rejected');
    return jsonResponse(request, { error: 'gmail_operation_not_allowed' }, 400);
  }

  try {
    if (!await consumeOperationLimit(user, allowed.operation, allowed.limit)) {
      return jsonResponse(request, { error: 'rate_limited' }, 429);
    }

    const accessToken = await getAccessToken(user.id);
    const body = request.method === 'POST' ? await request.text() : undefined;
    if (body && body.length > 35_000_000) {
      return jsonResponse(request, { error: 'request_too_large' }, 413);
    }

    let googleResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      method: allowed.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      body
    });

    if (googleResponse.status === 401) {
      const renewedAccessToken = await getAccessToken(user.id, true);
      googleResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
        method: allowed.method,
        headers: {
          Authorization: `Bearer ${renewedAccessToken}`,
          ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {})
        },
        body
      });
    }

    if (!googleResponse.ok) {
      const safeError = await readSafeGoogleError(googleResponse);
      await recordSecurityEvent(user.id, 'gmail_operation_failed', {
        operation: allowed.operation,
        google_status: googleResponse.status
      });
      return jsonResponse(request, { error: safeError.status, error_description: safeError.message }, googleResponse.status);
    }

    const responseBody = await googleResponse.arrayBuffer();
    return new Response(responseBody, {
      status: googleResponse.status,
      headers: {
        ...corsHeaders(request),
        'Cache-Control': 'no-store',
        'Content-Type': googleResponse.headers.get('Content-Type') || 'application/json',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'gmail_operation_failed';
    console.error('gmail-proxy failed', code);
    await recordSecurityEvent(user.id, 'gmail_operation_failed', {
      operation: allowed.operation
    });
    if (code === 'gmail_connection_required' || code === 'gmail_reconnect_required') {
      return jsonResponse(request, { error: code }, 401);
    }
    return jsonResponse(request, {
      error: 'gmail_operation_failed',
      error_description: 'The Gmail request could not be completed.'
    }, 502);
  }
});
