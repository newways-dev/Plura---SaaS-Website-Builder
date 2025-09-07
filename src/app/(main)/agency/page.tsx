import { getAuthUserDetails, verifyAndAcceptInvitation } from '@/lib/queries'
import { currentUser } from '@clerk/nextjs'
import { redirect } from 'next/navigation'

const Page = async () => {
  const authUser = await currentUser()

  if (!authUser) return redirect('/sign-in')

  const agencyId = await verifyAndAcceptInvitation()
  console.log(agencyId)

  //get the users details
  const user = await getAuthUserDetails()

  return <div>Agency Page</div>
}

export default Page
