/**
 * T3RMINAL Local Storage Module
 * Exports database, hooks, and types
 */

// Database
export {
  addSaleRecord,
  getSalesByMerchant,
  getSalesByCustomer,
  getSalesForAddress,
  searchSales,
  updateSyncStatus,
  markSaleFinalized,
  getPendingPayments,
  setSetting,
  getSetting,
  cacheReceipt,
  getCachedReceipt,
  addDailyReport,
  getAllDailyReports,
  addCsvReport,
  getAllCsvReports,
  getDailyReportByDate,
  isDayFinalized,
  hasReportForDate,
  clearAllData,
} from './database';

// Hooks
export {
  useSalesHistory,
  useTodaysIncome,
  useAddSale,
  useSale,
  useSyncState,
} from './hooks';

// Types
export type {
  SaleRecord,
  PendingPayment,
  AppSettings,
  ReceiptCache,
  SyncState,
  SyncStatus,
  TransactionType,
  DailyReportRecord,
  CsvReportRecord,
} from './types';
