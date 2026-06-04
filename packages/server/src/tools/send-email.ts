import { nanoid } from 'nanoid'

import { tool } from 'ai'

import { z } from 'zod'

import { db } from '../db/index.js'

export function makeSendEmailTool(userId: string) {
  return tool({
    description:
      'Send an email (simulated). The email is recorded in the system but not actually delivered. Use only when the user explicitly asks to send an email.',
    parameters: z.object({
      to: z.string().email().describe('Recipient email address'),
      subject: z.string().max(200).describe('Email subject line'),
      body: z.string().max(5000).describe('Email body text'),
    }),
    execute: async ({ to, subject, body }) => {
      const emailId = nanoid()
      try {
        db.prepare('INSERT INTO sent_emails (email_id, user_id, recipient, subject, body) VALUES (?, ?, ?, ?, ?)').run(
          emailId,
          userId,
          to,
          subject,
          body,
        )
        return {
          success: true,
          emailId,
          message: `Email to ${to} recorded (simulated — not actually sent)`,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { error: `Failed to record email: ${message}` }
      }
    },
  })
}
