const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation_failed', details: parsed.error.errors });
    }
    req.body = parsed.data;
    next();
  };
}

const uuid = z.string().uuid();
const msisdn = z.string().regex(/^2547\d{8}$/u, 'MSISDN must be E.164 2547xxxxxxxx');
const cashSchema = z.object({
  sacco_id: uuid,
  matatu_id: uuid.optional().nullable(),
  kind: z.enum(['SACCO_FEE','SAVINGS','LOAN_REPAY','CASH']).default('SACCO_FEE'),
  amount: z.number().int().positive().max(1_000_000),
  payer_name: z.string().min(1).max(120).optional().default(''),
  payer_phone: msisdn.optional().default(''),
  notes: z.string().max(500).optional().default('')
});

module.exports = { validate, cashSchema };

