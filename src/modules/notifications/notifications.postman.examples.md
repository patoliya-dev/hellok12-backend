# Notifications API examples

Base path: `/api/v1/notifications`  
Header: `Authorization: Bearer <access_token>`

## 1) List notifications

`GET /api/v1/notifications?page=1&limit=20&unread=true&type=LESSON_UPDATED&startDate=2026-01-01&endDate=2026-12-31`

Response (sample):

```json
{
  "success": true,
  "message": "Notifications fetched",
  "data": {
    "items": [
      {
        "_id": "67bcc0112a4f6d8fdaf09c77",
        "title": "Lesson updated",
        "message": "Lesson \"Math Basics\" was updated.",
        "type": "LESSON_UPDATED",
        "metadata": {
          "lessonId": "67bbc0112a4f6d8fdaf09a11",
          "courseId": "67bbc0112a4f6d8fdaf09a10",
          "deepLink": "/student/notifications"
        },
        "isRead": false,
        "readAt": null,
        "createdAt": "2026-02-24T09:17:04.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "pages": 1
  },
  "statusCode": 200
}
```

## 2) Unread count

`GET /api/v1/notifications/unread-count`

```json
{
  "success": true,
  "message": "Unread count fetched",
  "data": { "unreadCount": 4 },
  "statusCode": 200
}
```

## 3) Mark single notification as read

`PATCH /api/v1/notifications/67bcc0112a4f6d8fdaf09c77/read`

## 4) Mark all as read

`PATCH /api/v1/notifications/read-all`

Body (optional type filter):

```json
{
  "type": "PAYMENT_STATUS_UPDATED"
}
```

## 5) Delete notification

`DELETE /api/v1/notifications/67bcc0112a4f6d8fdaf09c77`
