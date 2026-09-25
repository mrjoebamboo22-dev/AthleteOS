# AthleteOS Outside-Contain Prototype

A dependency-free, local vertical slice showing the coach flow from observation through practice verification.

## Run

1. Install Node.js 18 or later.
2. In this folder run `npm start`.
3. Open `http://localhost:3000`.

## Test

Run `npm test`.

## Included

- Outside-contain seed data
- Coach-facing interactive prototype
- In-memory REST API routes for diagnosis, plans, assignments, athlete completion, guardian summary, and coach verification
- Demo role and object-level authorization checks
- Audit events for important writes

## Important limitations

This is a prototype, not production software. Data resets when the server restarts. Replace demo headers with managed authentication, connect PostgreSQL, implement consent workflows, validate all input, add rate limits and CSRF protections where applicable, use HTTPS, and complete privacy, legal, and security review before handling child data. AI-supported causes are presented as hypotheses and require coach confirmation. No injury diagnosis or automated contact-drill escalation is included.
