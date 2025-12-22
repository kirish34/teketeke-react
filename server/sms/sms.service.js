const pool = require('../db/pool');

function renderTemplateString(body, data = {}) {
  return body.replace(/{{\s*([\w.]+)\s*}}/g, (_m, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

async function renderTemplate(code, data) {
  const res = await pool.query(
    `select body from sms_templates where code = $1 and is_active = true limit 1`,
    [code]
  );
  if (!res.rows.length) throw new Error(`SMS template not found or inactive: ${code}`);
  return renderTemplateString(res.rows[0].body, data);
}

async function queueSms({ toPhone, templateCode = null, body, meta = {} }) {
  if (!toPhone) throw new Error('toPhone is required');
  if (!body) throw new Error('body is required');

  const result = await pool.query(
    `
      insert into sms_messages (to_phone, template_code, body, meta)
      values ($1, $2, $3, $4)
      returning id, status, created_at
    `,
    [toPhone, templateCode, body, meta]
  );

  return result.rows[0];
}

async function queueTemplatedSms({ toPhone, templateCode, data = {}, meta = {} }) {
  const renderedBody = await renderTemplate(templateCode, data);
  return queueSms({ toPhone, templateCode, body: renderedBody, meta });
}

module.exports = {
  renderTemplateString,
  renderTemplate,
  queueSms,
  queueTemplatedSms,
};
