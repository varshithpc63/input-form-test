import { Router } from 'express';
import {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
  getStats,
  exportOrdersCsv,
} from './db.ts';

export const apiRouter = Router();

// App & Environment Info
apiRouter.get('/app-info', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const detectedUrl = `${protocol}://${host}`;

  let publicUrl = process.env.APP_URL;
  if (!publicUrl && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    publicUrl = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  } else if (!publicUrl && process.env.VERCEL_URL) {
    publicUrl = `https://${process.env.VERCEL_URL}`;
  }
  if (!publicUrl) {
    publicUrl = detectedUrl;
  }

  res.json({
    publicUrl,
    detectedUrl,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    platform: process.env.VERCEL ? 'vercel' : 'node',
  });
});

// 1. Submit Form Endpoint (Public - used by embedded HTML forms)
apiRouter.post('/submissions', async (req, res) => {
  try {
    const { name, mobile, address, notes, id } = req.body;

    const errors: string[] = [];

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      errors.push('Full Name is required and must be at least 2 characters.');
    } else if (name.trim().length > 100) {
      errors.push('Full Name cannot exceed 100 characters.');
    }

    if (!mobile || typeof mobile !== 'string' || mobile.trim().length < 5) {
      errors.push('Mobile Number is required (at least 5 digits/characters).');
    } else if (mobile.trim().length > 30) {
      errors.push('Mobile Number cannot exceed 30 characters.');
    }

    if (!address || typeof address !== 'string' || address.trim().length < 5) {
      errors.push('Address is required (at least 5 characters).');
    } else if (address.trim().length > 1000) {
      errors.push('Address cannot exceed 1000 characters.');
    }

    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        error: errors.join(' '),
        errors,
      });
      return;
    }

    const cleanName = name.replace(/<[^>]*>?/gm, '').trim();
    const cleanMobile = mobile.replace(/<[^>]*>?/gm, '').trim();
    const cleanAddress = address.replace(/<[^>]*>?/gm, '').trim();

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const sourceUrl = (req.headers.referer as string) || (req.headers.origin as string) || 'direct-embed';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const newOrder = await createOrder({
      id,
      name: cleanName,
      mobile: cleanMobile,
      address: cleanAddress,
      notes,
      ip,
      sourceUrl,
      userAgent,
    });

    console.log(`[Order Created] ID: ${newOrder.id} for ${newOrder.name}`);

    res.status(201).json({
      success: true,
      orderId: newOrder.id,
      message: 'Order submitted successfully!',
      submission: newOrder,
    });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error processing order. Please try again.',
    });
  }
});

// 2. Get Submissions
apiRouter.get('/submissions', (req, res) => {
  try {
    const search = (req.query.search as string) || '';
    const status = (req.query.status as string) || 'all';
    const sortBy = (req.query.sortBy as 'date' | 'id' | 'name') || 'date';
    const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc';
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 10;

    const result = getAllOrders({
      search,
      status,
      sortBy,
      sortOrder,
      page,
      pageSize,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('Error fetching submissions:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch submissions' });
  }
});

// 3. Stats Summary
apiRouter.get('/submissions/stats', (_req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
  }
});

// 4. Export CSV
apiRouter.get('/submissions/export/csv', (_req, res) => {
  try {
    const csv = exportOrdersCsv();
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-export-${dateStr}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ success: false, error: 'Failed to export CSV' });
  }
});

// 5. Get Single Order Detail
apiRouter.get('/submissions/:id', (req, res) => {
  try {
    const order = getOrderById(req.params.id);
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    res.json({ success: true, submission: order });
  } catch (err) {
    console.error('Error getting order:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve order' });
  }
});

// 6. Update Status / Notes
apiRouter.patch('/submissions/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const updated = await updateOrderStatus(req.params.id, status, notes);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    res.json({ success: true, submission: updated });
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).json({ success: false, error: 'Failed to update order' });
  }
});

// 7. Delete Order
apiRouter.delete('/submissions/:id', async (req, res) => {
  try {
    const success = await deleteOrder(req.params.id);
    if (!success) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ success: false, error: 'Failed to delete order' });
  }
});
