const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('MAILER_SHARED_SECRET') || '';
    if (!expectedSecret || String(body.secret || '') !== expectedSecret) {
      return jsonResponse_({ ok: false, error: 'Unauthorized.' });
    }

    const to = String(body.to || '').trim().toLowerCase();
    const subject = String(body.subject || '').trim().slice(0, 250);
    const text = String(body.text || '');
    const html = String(body.html || '');
    const fromName = String(body.from_name || 'The Lost Realm Support').trim().slice(0, 120);
    const replyTo = String(body.reply_to || '').trim();

    if (!EMAIL_RE.test(to)) return jsonResponse_({ ok: false, error: 'Invalid recipient.' });
    if (!subject) return jsonResponse_({ ok: false, error: 'Missing subject.' });
    if (!text && !html) return jsonResponse_({ ok: false, error: 'Missing message body.' });

    const options = { name: fromName || 'The Lost Realm Support' };
    if (html) options.htmlBody = html;
    if (replyTo && EMAIL_RE.test(replyTo)) options.replyTo = replyTo;

    GmailApp.sendEmail(to, subject, text || 'The Lost Realm', options);
    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: 'Email could not be sent.' });
  }
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
