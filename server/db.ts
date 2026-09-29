import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OrderSubmission, DashboardStats } from '../src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVercel = Boolean(process.env.VERCEL);
const DATA_DIR = isVercel
  ? path.join('/tmp', 'orderflow-data')
  : path.resolve(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'orders.json');

// Memory cache + mutex queue to ensure atomic sequential operations
let inMemoryOrders: OrderSubmission[] = [];
let isInitialized = false;
let writeQueue: Promise<void> = Promise.resolve();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // If running on Vercel and /tmp DB doesn't exist yet, seed from project data/orders.json
  if (isVercel && !fs.existsSync(DB_FILE)) {
    try {
      const srcFile = path.resolve(__dirname, '../data/orders.json');
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, DB_FILE);
      }
    } catch (_) {}
  }
}

function formatDateDisplay(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

function seedDefaultOrders(): OrderSubmission[] {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');

  const sample1Time = new Date(now.getTime() - 25 * 60 * 1000).toISOString();
  const sample2Time = new Date(now.getTime() - 3 * 3600 * 1000).toISOString();
  const sample3Time = new Date(now.getTime() - 8 * 3600 * 1000).toISOString();

  return [
    {
      id: `ORD-${yyyymmdd}-000001`,
      name: 'Alexander Wright',
      mobile: '+1 (555) 234-8901',
      address: '742 Evergreen Terrace, Suite 4B\nSpringfield, OR 97477\nUnited States',
      createdAt: sample3Time,
      createdAtFormatted: formatDateDisplay(sample3Time),
      status: 'completed',
      notes: 'Customer verified by phone. Left parcel at porch door.',
      ip: '192.168.1.101',
    },
    {
      id: `ORD-${yyyymmdd}-000002`,
      name: 'Sophia Patel',
      mobile: '+1 (555) 872-3490',
      address: '1200 Grand Avenue, Apt 18\nAustin, TX 78701\nUnited States',
      createdAt: sample2Time,
      createdAtFormatted: formatDateDisplay(sample2Time),
      status: 'processing',
      notes: 'Rush priority requested.',
      ip: '192.168.1.102',
    },
    {
      id: `ORD-${yyyymmdd}-000003`,
      name: 'Marcus Chen',
      mobile: '+1 (555) 438-9120',
      address: '88 Market Street, Floor 14\nSan Francisco, CA 94105\nUnited States',
      createdAt: sample1Time,
      createdAtFormatted: formatDateDisplay(sample1Time),
      status: 'new',
      notes: 'Direct embed web form submission.',
      ip: '192.168.1.103',
    },
  ];
}

function loadDatabase(): void {
  if (isInitialized) return;
  ensureDataDir();

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryOrders = parsed;
        isInitialized = true;
        return;
      }
    } catch (err) {
      console.error('Failed to parse database file, re-initializing with seed:', err);
    }
  }

  // Seed default items
  inMemoryOrders = seedDefaultOrders();
  saveDatabaseSync();
  isInitialized = true;
}

function saveDatabaseSync(): void {
  ensureDataDir();
  const tmpFile = `${DB_FILE}.tmp.${Date.now()}`;
  const data = JSON.stringify(inMemoryOrders, null, 2);
  fs.writeFileSync(tmpFile, data, 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

function queueWrite(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    saveDatabaseSync();
  }).catch((err) => {
    console.error('Database write error:', err);
  });
  return writeQueue;
}

/**
 * Generate sequential Order ID matching format: ORD-YYYYMMDD-000001
 * Guarantees uniqueness and non-overlapping sequence.
 */
export function generateNextOrderId(): string {
  loadDatabase();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const datePrefix = `${yyyy}${mm}${dd}`;

  // Find all orders starting with this date
  const pattern = new RegExp(`^ORD-${datePrefix}-(\\d+)$`);
  let maxSeq = 0;

  for (const order of inMemoryOrders) {
    const match = order.id.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  let nextSeq = maxSeq + 1;
  let candidate = `ORD-${datePrefix}-${String(nextSeq).padStart(6, '0')}`;

  // Safety check: ensure no collision exists
  const existingIds = new Set(inMemoryOrders.map((o) => o.id));
  while (existingIds.has(candidate)) {
    nextSeq += 1;
    candidate = `ORD-${datePrefix}-${String(nextSeq).padStart(6, '0')}`;
  }

  return candidate;
}

export async function createOrder(data: {
  id?: string;
  name: string;
  mobile: string;
  address: string;
  notes?: string;
  ip?: string;
  sourceUrl?: string;
  userAgent?: string;
}): Promise<OrderSubmission> {
  loadDatabase();

  let id = generateNextOrderId();
  if (data.id && typeof data.id === 'string' && /^ORD-\d{8}-\d{6}$/i.test(data.id.trim())) {
    const requestedId = data.id.trim().toUpperCase();
    const existing = inMemoryOrders.find((o) => o.id === requestedId);
    if (!existing) {
      id = requestedId;
    }
  }

  const now = new Date().toISOString();

  const newOrder: OrderSubmission = {
    id,
    name: data.name.trim(),
    mobile: data.mobile.trim(),
    address: data.address.trim(),
    createdAt: now,
    createdAtFormatted: formatDateDisplay(now),
    status: 'new',
    notes: data.notes || '',
    ip: data.ip,
    sourceUrl: data.sourceUrl,
    userAgent: data.userAgent,
  };

  // Insert newest first
  inMemoryOrders.unshift(newOrder);
  await queueWrite();

  return newOrder;
}

export function getAllOrders(params?: {
  search?: string;
  status?: string;
  sortBy?: 'date' | 'id' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): {
  submissions: OrderSubmission[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  loadDatabase();

  let filtered = [...inMemoryOrders];

  // Search across Order ID, Name, Mobile, and Address
  if (params?.search && params.search.trim()) {
    const query = params.search.toLowerCase().trim();
    filtered = filtered.filter((order) => {
      return (
        order.id.toLowerCase().includes(query) ||
        order.name.toLowerCase().includes(query) ||
        order.mobile.toLowerCase().includes(query) ||
        order.address.toLowerCase().includes(query)
      );
    });
  }

  // Filter by status if specified
  if (params?.status && params.status !== 'all') {
    filtered = filtered.filter((order) => order.status === params.status);
  }

  // Sorting
  const sortBy = params?.sortBy || 'date';
  const sortOrder = params?.sortOrder || 'desc';

  filtered.sort((a, b) => {
    let comp = 0;
    if (sortBy === 'date') {
      comp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sortBy === 'id') {
      comp = a.id.localeCompare(b.id);
    } else if (sortBy === 'name') {
      comp = a.name.localeCompare(b.name);
    }
    return sortOrder === 'desc' ? -comp : comp;
  });

  const total = filtered.length;
  const page = Math.max(1, params?.page || 1);
  const pageSize = Math.max(1, params?.pageSize || 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const startIndex = (page - 1) * pageSize;
  const paginated = filtered.slice(startIndex, startIndex + pageSize);

  return {
    submissions: paginated,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export function getOrderById(id: string): OrderSubmission | null {
  loadDatabase();
  return inMemoryOrders.find((o) => o.id === id) || null;
}

export async function updateOrderStatus(
  id: string,
  status: OrderSubmission['status'],
  notes?: string
): Promise<OrderSubmission | null> {
  loadDatabase();
  const order = inMemoryOrders.find((o) => o.id === id);
  if (!order) return null;

  order.status = status;
  if (notes !== undefined) {
    order.notes = notes;
  }

  await queueWrite();
  return order;
}

export async function deleteOrder(id: string): Promise<boolean> {
  loadDatabase();
  const index = inMemoryOrders.findIndex((o) => o.id === id);
  if (index === -1) return false;

  inMemoryOrders.splice(index, 1);
  await queueWrite();
  return true;
}

export function getStats(): DashboardStats {
  loadDatabase();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  let todayCount = 0;
  const breakdown: DashboardStats['statusBreakdown'] = {
    new: 0,
    contacted: 0,
    processing: 0,
    completed: 0,
    cancelled: 0,
  };

  for (const order of inMemoryOrders) {
    const t = new Date(order.createdAt).getTime();
    if (t >= startOfDay) {
      todayCount += 1;
    }
    if (order.status in breakdown) {
      breakdown[order.status] += 1;
    }
  }

  const lastOrder = inMemoryOrders.length > 0 ? inMemoryOrders[0].id : null;

  return {
    total: inMemoryOrders.length,
    todayCount,
    lastOrderId: lastOrder,
    statusBreakdown: breakdown,
  };
}

export function exportOrdersCsv(): string {
  loadDatabase();

  const headers = ['Order ID', 'Name', 'Mobile Number', 'Address', 'Status', 'Submitted Date & Time', 'Notes'];

  const rows = inMemoryOrders.map((o) => {
    const escapeCsv = (val: string | undefined) => {
      if (!val) return '""';
      const clean = val.replace(/"/g, '""');
      return `"${clean}"`;
    };

    return [
      escapeCsv(o.id),
      escapeCsv(o.name),
      escapeCsv(o.mobile),
      escapeCsv(o.address),
      escapeCsv(o.status),
      escapeCsv(o.createdAtFormatted),
      escapeCsv(o.notes || ''),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
