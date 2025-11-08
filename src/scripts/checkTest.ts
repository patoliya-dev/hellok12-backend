import axios, { AxiosInstance } from 'axios';
import fs from 'fs';

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/';
const API_ENDPOINT = 'api/v1/find-teacher/list-old'; // Adjust this to your actual endpoint

// Test scenarios
const testScenarios = [
  {
    name: '1️⃣  No filters (baseline)',
    params: {
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '2️⃣  Single filter: Language',
    params: {
      languages: 'en',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '3️⃣  Single filter: Experience',
    params: {
      experience: '5-10',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '4️⃣  Single filter: Age Group',
    params: {
      ageRange: '9-11',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '5️⃣  Single filter: Price Range',
    params: {
      price: JSON.stringify([50, 200]),
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '6️⃣  Single filter: Rating',
    params: {
      rating: '4',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '7️⃣  Two filters: Language + Experience',
    params: {
      languages: 'sp',
      experience: '3-7',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '8️⃣  Two filters: Price + Rating',
    params: {
      price: JSON.stringify([100, 300]),
      rating: '3',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '9️⃣  Three filters: Language + Experience + Age',
    params: {
      languages: 'en',
      experience: '5-15',
      ageRange: '12-14',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '🔟 Four filters: Language + Experience + Price + Rating',
    params: {
      languages: 'fr',
      experience: '2-10',
      price: JSON.stringify([50, 250]),
      rating: '4',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '1️⃣1️⃣  All filters combined',
    params: {
      school: '', // Will be set dynamically
      languages: 'en',
      experience: '5-15',
      ageRange: '9-11',
      price: JSON.stringify([100, 300]),
      rating: '3',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '1️⃣2️⃣  High pagination offset',
    params: {
      languages: 'en',
      offset: '100',
      limit: '8'
    }
  },
  {
    name: '1️⃣3️⃣  Large page size',
    params: {
      experience: '3-10',
      offset: '0',
      limit: '50'
    }
  },
  {
    name: '1️⃣4️⃣  Price filter only (tests course lookup)',
    params: {
      price: JSON.stringify([20, 100]),
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '1️⃣5️⃣  Expensive price range (fewer results)',
    params: {
      price: JSON.stringify([400, 500]),
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '1️⃣6️⃣  Multiple languages',
    params: {
      languages: 'en',
      rating: '3',
      offset: '0',
      limit: '20'
    }
  },
  {
    name: '1️⃣7️⃣  Beginner experience range',
    params: {
      experience: '0-3',
      ageRange: '6-8',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '1️⃣8️⃣  Expert experience range',
    params: {
      experience: '20-30',
      rating: '4',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '1️⃣9️⃣  Mid-range pricing',
    params: {
      price: JSON.stringify([150, 250]),
      experience: '5-10',
      offset: '0',
      limit: '8'
    }
  },
  {
    name: '2️⃣0️⃣  Budget friendly',
    params: {
      price: JSON.stringify([10, 50]),
      languages: 'en',
      offset: '0',
      limit: '8'
    }
  }
];

interface BenchmarkResult {
  scenario: string;
  params: any;
  resultsCount: number;
  executionTime: number;
  statusCode: number;
  success: boolean;
  error?: string;
}

// Create axios instance
function createApiClient(): AxiosInstance {
  return axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json'
      // Add authentication headers if needed
      // 'Authorization': 'Bearer YOUR_TOKEN'
    }
  });
}

// Get a random school ID from the API
async function getRandomSchoolId(client: AxiosInstance): Promise<string | null> {
  try {
    // Adjust this endpoint to match your API
    const response = await client.get('/api/schools', {
      params: { limit: '1' }
    });

    if (response.data?.data && response.data.data.length > 0) {
      return response.data.data[0]._id || response.data.data[0].id;
    }
  } catch (error) {
    console.log('⚠️  Could not fetch school ID, skipping school filter test');
  }
  return null;
}

// Run a single benchmark test
async function runSingleTest(
  client: AxiosInstance,
  scenario: (typeof testScenarios)[0]
): Promise<BenchmarkResult> {
  const startTime = Date.now();

  try {
    const response = await client.get(API_ENDPOINT, {
      params: scenario.params
    });

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    return {
      scenario: scenario.name,
      params: scenario.params,
      resultsCount: response.data?.count || response.data?.data?.length || 0,
      executionTime,
      statusCode: response.status,
      success: response.data?.success !== false
    };
  } catch (error: any) {
    const endTime = Date.now();
    const executionTime = endTime - startTime;

    return {
      scenario: scenario.name,
      params: scenario.params,
      resultsCount: 0,
      executionTime,
      statusCode: error.response?.status || 0,
      success: false,
      error: error.message
    };
  }
}

// Run all benchmarks
async function runBenchmarks() {
  console.log('🔥 Starting API Performance Benchmarks...\n');
  console.log(`📍 Testing endpoint: ${API_BASE_URL}${API_ENDPOINT}\n`);

  const client = createApiClient();
  const results: BenchmarkResult[] = [];

  // Test API connectivity
  console.log('🔌 Testing API connectivity...');
  try {
    await client.get('/health').catch(() => {
      console.log('⚠️  Health check endpoint not available, continuing anyway...');
    });
    console.log('✅ API is reachable\n');
  } catch (error) {
    console.log('⚠️  Could not verify API connectivity, continuing anyway...\n');
  }

  // Get random school ID for the all-filters test
  console.log('🏫 Fetching random school ID for comprehensive test...');
  const schoolId = await getRandomSchoolId(client);
  if (schoolId) {
    testScenarios[10].params.school = schoolId;
    console.log(`✅ Using school ID: ${schoolId}\n`);
  } else {
    console.log('⚠️  Skipping school filter in comprehensive test\n');
    delete testScenarios[10].params.school;
  }

  // Run each test scenario
  for (let i = 0; i < testScenarios.length; i++) {
    const scenario = testScenarios[i];

    console.log(`\n${scenario.name}`);
    console.log('─'.repeat(50));
    console.log(`📋 Params: ${JSON.stringify(scenario.params, null, 2)}`);

    const result = await runSingleTest(client, scenario);

    if (result.success) {
      console.log(`✅ Results: ${result.resultsCount} teachers`);
      console.log(`⏱️  Execution time: ${result.executionTime}ms`);
      console.log(`📡 Status: ${result.statusCode}`);

      // Performance rating
      let rating = '🟢 Excellent';
      if (result.executionTime > 100) rating = '🟡 Good';
      if (result.executionTime > 500) rating = '🟠 Fair';
      if (result.executionTime > 1000) rating = '🔴 Slow';
      console.log(`${rating}`);
    } else {
      console.log(`❌ Request failed`);
      console.log(`⏱️  Time to failure: ${result.executionTime}ms`);
      console.log(`📡 Status: ${result.statusCode}`);
      console.log(`🔴 Error: ${result.error}`);
    }

    results.push(result);

    // Small delay between tests to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Generate summary report
  generateSummaryReport(results);

  // Save results to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `benchmark-results-${timestamp}.json`;
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\n💾 Detailed results saved to: ${filename}`);
}

// Generate summary report
function generateSummaryReport(results: BenchmarkResult[]) {
  console.log('\n\n' + '═'.repeat(70));
  console.log('📊 BENCHMARK SUMMARY');
  console.log('═'.repeat(70) + '\n');

  const successfulTests = results.filter(r => r.success);
  const failedTests = results.filter(r => !r.success);

  console.log(`Total tests: ${results.length}`);
  console.log(`✅ Successful: ${successfulTests.length}`);
  console.log(`❌ Failed: ${failedTests.length}\n`);

  if (successfulTests.length > 0) {
    const avgTime =
      successfulTests.reduce((sum, r) => sum + r.executionTime, 0) / successfulTests.length;
    const maxTime = Math.max(...successfulTests.map(r => r.executionTime));
    const minTime = Math.min(...successfulTests.map(r => r.executionTime));
    const totalResults = successfulTests.reduce((sum, r) => sum + r.resultsCount, 0);

    console.log('⏱️  Timing Statistics:');
    console.log(`   Average execution time: ${avgTime.toFixed(2)}ms`);
    console.log(`   Fastest query: ${minTime}ms`);
    console.log(`   Slowest query: ${maxTime}ms\n`);

    console.log('📊 Results Statistics:');
    console.log(`   Total teachers returned: ${totalResults}`);
    console.log(
      `   Average results per query: ${(totalResults / successfulTests.length).toFixed(2)}\n`
    );

    console.log('📈 Top 5 Slowest Queries:');
    successfulTests
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(
          `   ${i + 1}. ${r.scenario} - ${r.executionTime}ms (${r.resultsCount} results)`
        );
      });

    console.log('\n⚡ Top 5 Fastest Queries:');
    successfulTests
      .sort((a, b) => a.executionTime - b.executionTime)
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(
          `   ${i + 1}. ${r.scenario} - ${r.executionTime}ms (${r.resultsCount} results)`
        );
      });

    console.log('\n💡 Performance Analysis:');
    const slowQueries = successfulTests.filter(r => r.executionTime > 500);
    const excellentQueries = successfulTests.filter(r => r.executionTime <= 100);

    if (slowQueries.length > 0) {
      console.log(`   ⚠️  ${slowQueries.length} queries took over 500ms`);
      console.log('   → Consider optimizing these endpoints');
      console.log('   → Review database indexes');
      console.log('   → Check for N+1 queries');
    }

    if (excellentQueries.length > 0) {
      console.log(`   ✅ ${excellentQueries.length} queries performed excellently (<100ms)`);
    }

    const avgResultsPerMs =
      totalResults / successfulTests.reduce((sum, r) => sum + r.executionTime, 0);
    console.log(`   📊 Throughput: ${(avgResultsPerMs * 1000).toFixed(2)} results/second`);
  }

  if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    failedTests.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.scenario}`);
      console.log(`      Error: ${r.error}`);
      console.log(`      Status: ${r.statusCode}`);
    });
  }

  console.log('\n' + '═'.repeat(70));
}

// Concurrent load testing
async function runConcurrentLoadTest(concurrency: number = 10, iterations: number = 5) {
  console.log(`\n\n🚀 Running Concurrent Load Test`);
  console.log(`   Concurrency: ${concurrency} simultaneous requests`);
  console.log(`   Iterations: ${iterations} times\n`);

  const client = createApiClient();
  const testCase = testScenarios[1]; // Use a simple test case

  for (let iter = 1; iter <= iterations; iter++) {
    console.log(`\n📊 Iteration ${iter}/${iterations}`);

    const startTime = Date.now();
    const promises = Array(concurrency)
      .fill(null)
      .map(() => runSingleTest(client, testCase));

    const results = await Promise.all(promises);
    const endTime = Date.now();
    const totalTime = endTime - startTime;

    const successful = results.filter(r => r.success).length;
    const avgResponseTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;

    console.log(`   Total time: ${totalTime}ms`);
    console.log(`   Successful: ${successful}/${concurrency}`);
    console.log(`   Avg response time: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`   Requests/second: ${(concurrency / (totalTime / 1000)).toFixed(2)}`);

    // Delay between iterations
    if (iter < iterations) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'benchmark';

  try {
    if (mode === 'benchmark' || mode === 'both') {
      await runBenchmarks();
    }

    if (mode === 'load' || mode === 'both') {
      const concurrency = parseInt(args[1]) || 10;
      const iterations = parseInt(args[2]) || 5;
      await runConcurrentLoadTest(concurrency, iterations);
    }

    console.log('\n🎉 All tests completed!');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
