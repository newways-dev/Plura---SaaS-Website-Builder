import type { Prisma } from '@prisma/client'
import { getAuthUserDetails, getUserPermissions } from './queries'

// Array of Notification including related User, matching:
// db.notification.findMany({ include: { User: true } })
export type NotificationWithUser =
  | Prisma.NotificationGetPayload<{ include: { User: true } }>[]
  | undefined

export type UserWithPermissionsAndSubAccounts = Prisma.PromiseReturnType<
  typeof getUserPermissions
>

export type AuthUserWithAgencySigebarOptionsSubAccounts =
  Prisma.PromiseReturnType<typeof getAuthUserDetails>
