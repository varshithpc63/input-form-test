import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.tsx';
import { StatsCards } from './components/StatsCards.tsx';
import { SubmissionsTable } from './components/SubmissionsTable.tsx';
import { OrderDetailModal } from './components/OrderDetailModal.tsx';
import { FormBuilderTab } from './components/FormBuilderTab.tsx';
import { LiveEmbedSimulator } from './components/LiveEmbedSimulator.tsx';
import { SetupInstructionsTab } from './components/SetupInstructionsTab.tsx';
import type { OrderSubmission, DashboardStats } from './types.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<'submissions' | 'builder' | 'preview' | 'docs'>('submissions');
  const [submissions, setSubmissions] = useState<OrderSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'id' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<OrderSubmission | null>(null);

  const [stats, setStats] = useState<DashboardStats>({
    total: 0,
    todayCount: 0,
    lastOrderId: null,
    statusBreakdown: {
      new: 0,
      contacted: 0,
      processing: 0,
      completed: 0,
      cancelled: 0,
    },
  });

  const [publicUrl, setPublicUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  });

  const [isOnline, setIsOnline] = useState(true);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch App info and public target URL
  const fetchAppInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/app-info');
      if (res.ok) {
        const data = await res.json();
        if (data.publicUrl) {
          setPublicUrl(data.publicUrl);
        }
        setIsOnline(true);
      }
    } catch (err) {
      console.warn('Could not fetch app info:', err);
    }
  }, []);

  // Fetch stats summary
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/submissions/stats');
      if (res.ok) {
        const data = await res.json();
        if (data.stats) {
          setStats(data.stats);
          setIsOnline(true);
        }
      }
    } catch (err) {
      console.warn('Could not fetch stats:', err);
      setIsOnline(false);
    }
  }, []);

  // Fetch Submissions Table
  const fetchSubmissions = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        search: searchQuery,
        status: statusFilter,
        sortBy,
        sortOrder,
        page: String(page),
        pageSize: String(pageSize),
      });

      const res = await fetch(`/api/submissions?${queryParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSubmissions(data.submissions || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setIsOnline(true);
      } else {
        setIsOnline(false);
      }
    } catch (err) {
      console.error('Error fetching submissions:', err);
      setIsOnline(false);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [searchQuery, statusFilter, sortBy, sortOrder, page, pageSize]);

  // Initial load
  useEffect(() => {
    fetchAppInfo();
    fetchStats();
    fetchSubmissions();
  }, [fetchAppInfo, fetchStats, fetchSubmissions]);

  // Live auto-refresh polling (every 8 seconds when enabled)
  useEffect(() => {
    if (!autoRefresh) return;

    pollTimerRef.current = setInterval(() => {
      fetchSubmissions(true);
      fetchStats();
    }, 8000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [autoRefresh, fetchSubmissions, fetchStats]);

  // Handle status update
  const handleUpdateStatus = async (
    id: string,
    status: OrderSubmission['status'],
    notes?: string
  ) => {
    try {
      const res = await fetch(`/api/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedOrder(data.submission);
        fetchSubmissions(true);
        fetchStats();
      }
    } catch (err) {
      console.error('Update failed:', err);
      alert('Failed to update order status');
    }
  };

  // Handle order deletion
  const handleDeleteOrder = async (id: string) => {
    try {
      const res = await fetch(`/api/submissions/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSelectedOrder(null);
        fetchSubmissions();
        fetchStats();
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete order');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Header & Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        totalSubmissions={stats.total}
        publicUrl={publicUrl}
        isOnline={isOnline}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Tab 1: Submissions Table (Admin Dashboard) */}
        {activeTab === 'submissions' && (
          <div className="space-y-6">
            {/* Top Stat Cards */}
            <StatsCards stats={stats} />

            {/* Submissions Data Table */}
            <SubmissionsTable
              submissions={submissions}
              total={total}
              page={page}
              pageSize={pageSize}
              totalPages={totalPages}
              loading={loading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
              setPage={setPage}
              setPageSize={setPageSize}
              onRefresh={() => {
                fetchSubmissions();
                fetchStats();
              }}
              onSelectOrder={(order) => setSelectedOrder(order)}
              onDeleteOrder={handleDeleteOrder}
              autoRefresh={autoRefresh}
              setAutoRefresh={setAutoRefresh}
            />
          </div>
        )}

        {/* Tab 2: Form Builder & HTML Generator */}
        {activeTab === 'builder' && (
          <FormBuilderTab
            publicBaseUrl={publicUrl}
            onJumpToTester={() => setActiveTab('preview')}
          />
        )}

        {/* Tab 3: Live Embed Sandbox */}
        {activeTab === 'preview' && (
          <LiveEmbedSimulator
            publicBaseUrl={publicUrl}
            onOrderSubmitted={() => {
              fetchSubmissions(true);
              fetchStats();
            }}
            onGoToSubmissions={() => setActiveTab('submissions')}
          />
        )}

        {/* Tab 4: Setup & Architecture Documentation */}
        {activeTab === 'docs' && <SetupInstructionsTab publicUrl={publicUrl} />}
      </main>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={handleUpdateStatus}
          onDelete={handleDeleteOrder}
        />
      )}
    </div>
  );
}
