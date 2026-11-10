import { redirect } from 'next/navigation';

// The account menu's one Admin link; each admin page checks the viewer itself
export default function AdminPage() {
  redirect('/admin/promotions');
}
