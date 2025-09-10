'use server'

import { clerkClient, currentUser } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { db } from './db'
import { Agency, Plan, User } from '@prisma/client'
import * as z from 'zod'

export const getAuthUserDetails = async () => {
  const user = await currentUser()
  if (!user) {
    return
  }

  const userData = await db.user.findUnique({
    where: {
      email: user.emailAddresses[0].emailAddress,
    },
    include: {
      Agency: {
        include: {
          SidebarOption: true,
        },
      },
      Permissions: true,
    },
  })

  return userData
}

export const saveActivityLogsNotification = async ({
  agencyId,
  description,
  subaccountId,
}: {
  agencyId?: string
  description: string
  subaccountId?: string
}) => {
  const authUser = await currentUser()
  let userData
  if (!authUser) {
    const response = await db.user.findFirst({
      where: {
        Agency: {
          SubAccount: {
            some: { id: subaccountId },
          },
        },
      },
    })
    if (response) {
      userData = response
    }
  } else {
    userData = await db.user.findUnique({
      where: { email: authUser?.emailAddresses[0].emailAddress },
    })
  }

  if (!userData) {
    console.log('Could not find a user')
    return
  }

  let foundAgencyId = agencyId
  if (!foundAgencyId) {
    if (!subaccountId) {
      throw new Error(
        'You need to provide atleast an agency Id or subaccount Id'
      )
    }
    const response = await db.subAccount.findUnique({
      where: { id: subaccountId },
    })
    if (response) foundAgencyId = response.agencyId
  }
  if (subaccountId) {
    await db.notification.create({
      data: {
        notification: `${userData.name} | ${description}`,
        User: {
          connect: {
            id: userData.id,
          },
        },
        Agency: {
          connect: {
            id: foundAgencyId,
          },
        },
        SubAccount: {
          connect: { id: subaccountId },
        },
      },
    })
  } else {
    await db.notification.create({
      data: {
        notification: `${userData.name} | ${description}`,
        User: {
          connect: {
            id: userData.id,
          },
        },
        Agency: {
          connect: {
            id: foundAgencyId,
          },
        },
      },
    })
  }
}

export const createTeamUser = async (agencyId: string, user: User) => {
  if (user.role === 'AGENCY_OWNER') return null
  const response = await db.user.create({ data: { ...user } })
  return response
}

export const verifyAndAcceptInvitation = async () => {
  const user = await currentUser()
  if (!user) return redirect('/sign-in')

  const invitationExists = await db.invitation.findUnique({
    where: {
      email: user.emailAddresses[0].emailAddress,
      status: 'PENDING',
    },
  })

  if (invitationExists) {
    const userDetails = await createTeamUser(invitationExists.agencyId, {
      email: invitationExists.email,
      agencyId: invitationExists.agencyId,
      avatarUrl: user.imageUrl,
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      role: invitationExists.role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await saveActivityLogsNotification({
      agencyId: invitationExists?.agencyId,
      description: `Joined`,
      subaccountId: undefined,
    })

    if (userDetails) {
      try {
        await clerkClient.users.updateUserMetadata(user.id, {
          privateMetadata: {
            role: userDetails.role || 'SUBACCOUNT_USER',
          },
        })
      } catch (err) {
        console.error('Failed to update Clerk user metadata (invitation):', err)
        // Do not block flow if Clerk metadata update fails in dev
      }

      await db.invitation.delete({
        where: { email: userDetails.email },
      })

      return userDetails.agencyId
    } else return null
  } else {
    const agency = await db.user.findUnique({
      where: {
        email: user.emailAddresses[0].emailAddress,
      },
    })
    return agency ? agency.agencyId : null
  }
}

export const updateAgencyDetails = async (
  agencyId: string,
  agencyDetails: Partial<Agency>
) => {
  const response = await db.agency.update({
    where: { id: agencyId },
    data: { ...agencyDetails },
  })
  return response
}

export const deleteAgency = async (agencyId: string) => {
  const response = await db.agency.delete({ where: { id: agencyId } })
  return response
}

export const initUser = async (newUser: Partial<User>) => {
  const user = await currentUser()
  if (!user) return

  const userData = await db.user.upsert({
    where: {
      email: user.emailAddresses[0].emailAddress,
    },
    update: newUser,
    create: {
      id: user.id,
      avatarUrl: user.imageUrl,
      email: user.emailAddresses[0].emailAddress,
      name: `${user.firstName} ${user.lastName}`,
      role: newUser.role || 'SUBACCOUNT_USER',
    },
  })

  try {
    await clerkClient.users.updateUserMetadata(user.id, {
      privateMetadata: {
        role: newUser.role || 'SUBACCOUNT_USER',
      },
    })
  } catch (err) {
    console.error('Failed to update Clerk user metadata (initUser):', err)
  }

  return userData
}

const UpsertAgencySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  agencyLogo: z.string().trim().min(1),
  companyEmail: z.string().trim().min(1),
  companyPhone: z.string().trim().min(1),
  whiteLabel: z.boolean(),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  zipCode: z.string().trim().min(1),
  state: z.string().trim().min(1),
  country: z.string().trim().min(1),
  connectAccountId: z.string().optional().default(''),
  goal: z.number().int().optional().default(5),
})

export type UpsertAgencyInput = z.infer<typeof UpsertAgencySchema>

export const upsertAgency = async (input: UpsertAgencyInput, price?: Plan) => {
  const agency = UpsertAgencySchema.parse(input)
  const agencyDetails = await db.agency.upsert({
    where: {
      id: agency.id,
    },
    update: {
      name: agency.name,
      agencyLogo: agency.agencyLogo,
      companyEmail: agency.companyEmail,
      companyPhone: agency.companyPhone,
      whiteLabel: agency.whiteLabel,
      address: agency.address,
      city: agency.city,
      zipCode: agency.zipCode,
      state: agency.state,
      country: agency.country,
      connectAccountId: agency.connectAccountId,
      goal: agency.goal,
    },
    create: {
      id: agency.id,
      name: agency.name,
      agencyLogo: agency.agencyLogo,
      companyEmail: agency.companyEmail,
      companyPhone: agency.companyPhone,
      whiteLabel: agency.whiteLabel,
      address: agency.address,
      city: agency.city,
      zipCode: agency.zipCode,
      state: agency.state,
      country: agency.country,
      connectAccountId: agency.connectAccountId,
      goal: agency.goal,
      users: {
        connect: { email: agency.companyEmail },
      },
      SidebarOption: {
        create: [
          {
            name: 'Dashboard',
            icon: 'category',
            link: `/agency/${agency.id}`,
          },
          {
            name: 'Launchpad',
            icon: 'clipboardIcon',
            link: `/agency/${agency.id}/launchpad`,
          },
          {
            name: 'Billing',
            icon: 'payment',
            link: `/agency/${agency.id}/billing`,
          },
          {
            name: 'Settings',
            icon: 'settings',
            link: `/agency/${agency.id}/settings`,
          },
          {
            name: 'Sub Accounts',
            icon: 'person',
            link: `/agency/${agency.id}/all-subaccounts`,
          },
          {
            name: 'Team',
            icon: 'shield',
            link: `/agency/${agency.id}/team`,
          },
        ],
      },
    },
  })

  return agencyDetails
}
