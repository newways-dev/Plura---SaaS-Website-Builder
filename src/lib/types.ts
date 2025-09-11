import type { Prisma } from '@prisma/client'

// Array of Notification including related User, matching:
// db.notification.findMany({ include: { User: true } })
export type NotificationWithUser =
  | Prisma.NotificationGetPayload<{ include: { User: true } }>[]
  | undefined
