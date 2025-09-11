import type { Prisma } from '@prisma/client'
import { getAuthUserDetails, getUserPermissions } from './queries'
import { db } from './db'

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

const __getUsersWithAgencySubAccountPermissionsSidebarOptions = async (
  agencyId: string
) => {
  return await db.user.findFirst({
    where: { Agency: { id: agencyId } },
    include: {
      Agency: { include: { SubAccount: true } },
      Permissions: { include: { SubAccount: true } },
    },
  })
}

export type UsersWithAgencySubAccountPermissionsSidebarOptions =
  Prisma.PromiseReturnType<
    typeof __getUsersWithAgencySubAccountPermissionsSidebarOptions
  >
