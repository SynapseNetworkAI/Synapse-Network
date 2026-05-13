export function readEmailEvidence(
  queryJson,
  sqlLiteral,
  owner,
  email,
  templateKey = "email_verification"
) {
  return (
    queryJson(`
      SELECT row_to_json(result)
      FROM (
        SELECT
          (SELECT count(*)::int FROM synapse_notification_outbox
           WHERE recipient_owner_id = lower(${sqlLiteral(owner)})
             AND recipient_email = ${sqlLiteral(email)}
             AND template_key = ${sqlLiteral(templateKey)}) AS "outboxCount",
          (SELECT count(*)::int FROM synapse_notification_delivery_log
           WHERE recipient_owner_id = lower(${sqlLiteral(owner)})
             AND recipient_email = ${sqlLiteral(email)}
             AND template_key = ${sqlLiteral(templateKey)}) AS "deliveryCount"
      ) result;
    `) || {}
  );
}

export async function waitForEmailEvidence(
  queryJson,
  sqlLiteral,
  owner,
  email,
  templateKey = "email_verification",
  timeoutMs = 30_000
) {
  const startedAt = Date.now();
  let lastEvidence = {};
  while (Date.now() - startedAt < timeoutMs) {
    lastEvidence = readEmailEvidence(
      queryJson,
      sqlLiteral,
      owner,
      email,
      templateKey
    );
    if (Number(lastEvidence.deliveryCount || 0) >= 1) {
      return lastEvidence;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lastEvidence;
}
