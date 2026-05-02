import { supabase, getCurrentUser } from './supabase.js';
import { getOrganizerEvents } from './events.js';
import { safeQuery } from './api.js';

export async function fetchDashboardStats() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not authenticated');
    
    const events = await getOrganizerEvents();
    
    let totalTickets = 0, totalRevenue = 0, totalScanned = 0, revenueData = null;
    const { data, error } = await safeQuery(
      supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id })
    );
    
    if (data) {
      revenueData = data;
      data.forEach(r => {
        totalTickets += Number(r.total_tickets_sold);
        totalRevenue += Number(r.net_revenue);
        totalScanned += Number(r.scanned_count);
      });
    }

    return {
      user,
      events,
      revenueData,
      stats: {
        totalTickets,
        totalRevenue,
        totalScanned,
        scanRate: totalTickets > 0 ? Math.round((totalScanned / totalTickets) * 100) : 0,
        totalEvents: events.length,
        liveEvents: events.filter(e => e.status === 'published').length,
        draftEvents: events.filter(e => e.status === 'draft').length,
        pastEvents: events.filter(e => new Date(e.date) < new Date()).length,
        reviewEvents: events.filter(e => e.status === 'review' || e.status === 'in_review').length
      }
    };
  } catch (err) {
    console.error('Failed to fetch dashboard stats', err);
    throw err;
  }
}
