interface DashboardStats {
  upcomingSessions: {
    count: number;
    thisWeek: number;
    changeFromLastWeek: number;
  };
  trialBookings: {
    count: number;
    pending: number;
    newRequests: number;
  };
  averageRating: {
    rating: number;
    totalReviews: number;
  };
  monthlyEarnings: {
    amount: number;
    currency: string;
    month: string;
    changeFromLastMonth: number;
  };
}
