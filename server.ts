import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
  getStats,
  exportOrdersCsv,
} from './server/db.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function bootstrap() {
  const app = express();

  // Enable CORS for all origins - critical for embedded HTML forms on third-party websites!
  app.use(
    cors({
      origin: (origin, callback) => {
        // Echo origin back to allow credentials and handle file:/// (origin null) or external origins
        callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    })
  );

  // Explicit preflight handler to guarantee 204 status on OPTIONS
  app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.status(204).end();
  });

  // Parse JSON and urlencoded request bodies
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request logger in dev
  if (!isProduction) {
    app.use((req, _res, next) => {
      if (req.path.startsWith('/api')) {
        console.log(`[API ${req.method}] ${req.path}`);
      }
      next();
    });
  }

  // --- API Routes ---

  // App & Environment Info (tells frontend what URL to use in generated embed snippet)
  app.get('/api/app-info', (req, res) => {
    // Determine the base URL for embed forms:
    // If APP_URL env var is provided by Cloud Run / AI Studio, use that.
    // Otherwise fallback to protocol + host from request.
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const detectedUrl = `${protocol}://${host}`;
    const publicUrl = process.env.APP_URL || detectedUrl;

    res.json({
      publicUrl,
      detectedUrl,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // 1. Submit Form Endpoint (Public - used by embedded HTML forms)
  app.post('/api/submissions', async (req, res) => {
    try {
      const { name, mobile, address, notes } = req.body;

      // Validation
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

      // Sanitize inputs
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
        name: cleanName,
        mobile: cleanMobile,
        address: cleanAddress,
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

  // 2. Get Submissions (Admin Dashboard Table with search, sorting, pagination)
  app.get('/api/submissions', (req, res) => {
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
  app.get('/api/submissions/stats', (_req, res) => {
    try {
      const stats = getStats();
      res.json({ success: true, stats });
    } catch (err) {
      console.error('Error fetching stats:', err);
      res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
    }
  });

  // 4. Export CSV
  app.get('/api/submissions/export/csv', (_req, res) => {
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
  app.get('/api/submissions/:id', (req, res) => {
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
  app.patch('/api/submissions/:id', async (req, res) => {
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
  app.delete('/api/submissions/:id', async (req, res) => {
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

  // Mount Vite or static files
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OrderFlow Server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
