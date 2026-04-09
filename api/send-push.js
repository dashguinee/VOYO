import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

// VAPID keys (shared across all DASH apps)
const VAPID_PUBLIC = 'BCyj-APsdQcUR9qo7rnUNJ05LOCBKhv3wO2RQuX7Ws4jbYRkqrqc5jDMLe8mrfqmwdMs_XcWqUdZfjNTOO2Zjhg'
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'kKvKzUQqKzn3kYXWpHx_jNONOKc42fTWAzoy91k3-04'

webpush.setVapidDetails('mailto:push@dasuperhub.com', VAPID_PUBLIC, VAPID_PRIVATE)

// Supabase service client (Command Center — where dash_push_tokens lives)
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://mclbbkmpovnvcfmwsoqt.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || ''
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }

  const { title, body, url, icon, userId, app = 'voyo' } = req.body || {}

  if (!title || !body) {
    return res.status(400).json({ error: 'title and body required' })
  }

  // Build query — target specific user or all subscribers for this app
  let query = supabase.from('dash_push_tokens').select('subscription')

  if (userId) {
    query = query.eq('user_id', userId)
  }

  query = query.eq('app', app)

  const { data: tokens, error } = await query

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  if (!tokens || tokens.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No subscribers found' })
  }

  const payload = JSON.stringify({ title, body, url: url || '/', icon: icon || '/icons/voyo-192.svg' })

  let sent = 0
  let failed = 0
  const stale = []

  for (const row of tokens) {
    try {
      await webpush.sendNotification(row.subscription, payload)
      sent++
    } catch (err) {
      failed++
      // 410 Gone or 404 = subscription expired, mark for cleanup
      if (err.statusCode === 410 || err.statusCode === 404) {
        stale.push(row.subscription.endpoint)
      }
    }
  }

  // Clean up stale subscriptions
  if (stale.length > 0) {
    for (const endpoint of stale) {
      await supabase
        .from('dash_push_tokens')
        .delete()
        .eq('subscription->>endpoint', endpoint)
    }
  }

  return res.status(200).json({ sent, failed, cleaned: stale.length })
}
