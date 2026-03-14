/**
 * Zod validation middleware factory.
 * Usage: app.post('/route', validate(schema), handler)
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  req.body = result.data; // replace with parsed/coerced data
  next();
};

module.exports = validate;
