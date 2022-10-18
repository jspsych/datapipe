// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

export default function handler(req, res) {
  res.status(200).json({ name: 'John Doe' })
}

// see this for CORS stuff: https://github.com/vercel/next.js/blob/canary/examples/api-routes-cors/pages/api/cors.ts
