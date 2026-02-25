export const formatStudent = (student: any) => {
  if (!student) return null;

  return {
    _id: student._id.toString(),
    name: student.name,
    age: student.age ? student.age : 0,
    status: student.bookingType
  };
};

export const formatStudentInfo = (studentData: any[], courseType: string) => {
  if (!studentData || studentData.length === 0) return null;

  return courseType === 'group'
    ? studentData.map(student => formatStudent(student))
    : formatStudent(studentData[0]);
};

export const formatDateTime = (date: Date) => {
  return {
    date: date.toISOString().split('T')[0],
    time: new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  };
};

export const transformSessionToLesson = (session: any, role?: string) => {
  const canShowJoinUrl = role === 'teacher'; // school/parent/student should not see joinUrl here
  return {
    _id: session._id.toString(),
    dateTime: formatDateTime(session.start),
    student: formatStudentInfo(session.studentData, session.courseType),
    courseType: session.courseType,
    subject: { name: session.courseName, mode: session.courseMode },
    duration: session.duration,
    status: session.status,
    joinUrl: canShowJoinUrl ? session.joinUrl || null : null
  };
};

export const buildDateFilter = (startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) return null;

  const filter: any = {};
  if (startDate) filter.$gte = new Date(startDate);
  if (endDate) filter.$lte = new Date(endDate);

  return filter;
};
