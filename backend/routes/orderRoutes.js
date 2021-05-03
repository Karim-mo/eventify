import express from 'express';
import asyncHandler from 'express-async-handler';
import User from '../models/UserModel.js';
import Order from '../models/OrderModel.js';
import Event from '../models/EventModel.js';
import PromoCode from '../models/PromoModel.js';
import { protect, admin } from '../middleware/auth.js';
import request from 'request';
import crypto from 'crypto';
import colors from 'colors';

const router = express.Router();

const editEventTickets = async (orderID) => {
	// Deduct available tickets
};

const getUserOrders = asyncHandler(async (req, res) => {
	try {
	} catch (error) {}
});

const createOrder = asyncHandler(async (req, res) => {
	const cart = req.user.cart;
	if (cart.length > 0) {
		const today = new Date();
		let updatedCart = await Promise.all(
			cart.map(async (ticket) => {
				const event = await Event.findById(ticket.eventID);
				const date = new Date(
					event.endsOn.year,
					event.endsOn.month - 1,
					event.endsOn.day + 1
				);
				if (today >= date) {
					return;
				}
				return ticket;
			})
		);
		updatedCart = updatedCart.filter((ticket) => ticket);
		req.user.cart = updatedCart;
		await req.user.save();
		if (updatedCart.length <= 0) {
			res.status(400);
			throw new Error(
				'Cart has been cleared of expired items and is now empty, cannot proceed.'
			);
		}

		const itemsPrice = cart
			.reduce((acc, ticket) => acc + ticket.ticketPrice, 0)
			.toFixed(2);
		const fees = cart
			.reduce((acc, ticket) => acc + 0.05 * ticket.ticketPrice, 0)
			.toFixed(2);
		const totalPrice = cart
			.reduce((acc, ticket) => acc + 1.05 * ticket.ticketPrice, 0)
			.toFixed(2);
		const order = await Order.create({
			userID: req.user._id,
			orderItems: updatedCart,
			paymentMethod: 'paypal',
			paymentDetails: {
				status: 'PENDING',
			},
			itemsPrice,
			fees,
			totalPrice,
		});

		request.post(
			'https://api-m.sandbox.paypal.com/v2/checkout/orders',
			{
				auth: {
					user: process.env.CLIENT_ID,
					pass: process.env.CLIENT_PW,
				},
				body: {
					intent: 'CAPTURE',
					purchase_units: [
						{
							amount: {
								value: totalPrice.toString(),
								currency_code: 'USD',
							},
						},
					],
				},
				json: true,
			},
			asyncHandler(async (err, response) => {
				if (err) {
					res.status(500);
					const err = new Error(
						'Failed to create order, try again later.'
					);
					res.json({
						message: err.message,
						stack:
							process.env.DEV_MODE === 'production'
								? null
								: err.stack,
					});
					return;
				}
				order.paymentDetails = {
					...order.paymentDetails,
					paymentID: response.body.id,
				};
				await order.save();
				req.user.cart = [];
				await req.user.save();
				res.json({
					orderID: order._id,
				});
			})
		);
	} else {
		res.status(400);
		throw new Error('Cart is empty, cannot create order.');
	}
});

const getPaypalOrder = asyncHandler(async (req, res) => {
	const order = await Order.findById(req.params.id);
	if (order) {
		request.get(
			`https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.paymentDetails.paymentID}`,
			{
				auth: {
					user: process.env.CLIENT_ID,
					pass: process.env.CLIENT_PW,
				},
				json: true,
			},
			asyncHandler(async (err, response) => {
				if (err) {
					res.status(500);
					const err = new Error('An unknown error occurred.');
					res.json({
						message: err.message,
						stack:
							process.env.DEV_MODE === 'production'
								? null
								: err.stack,
					});
					return;
				}
				if (
					response.body.name &&
					response.body.name === 'RESOURCE_NOT_FOUND'
				) {
					res.status(401);
					const err = new Error(
						'Payment ID could not be retrieved, please refresh the page or contact customer support'
					);
					res.json({
						message: err.message,
						stack:
							process.env.DEV_MODE === 'production'
								? null
								: err.stack,
					});
					return;
				}
				res.json({
					paymentID: response.body.id,
				});
			})
		);
	} else {
		res.status(404);
		throw new Error(
			'Order not found, try again or contact customer support.'
		);
	}
});

const confirmOrder = asyncHandler(async (req, res) => {
	const { orderID } = req.body;
	const order = await Order.findById(orderID);
	if (order) {
		request.get(
			`https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.paymentDetails.paymentID}`,
			{
				auth: {
					user: process.env.CLIENT_ID,
					pass: process.env.CLIENT_PW,
				},
				json: true,
			},
			asyncHandler(async (err, response) => {
				if (err) {
					res.status(500);
					const err = new Error('An unknown error occurred.');
					res.json({
						message: err.message,
						stack:
							process.env.DEV_MODE === 'production'
								? null
								: err.stack,
					});
					return;
				}
				if (
					response.body.name &&
					response.body.name === 'RESOURCE_NOT_FOUND'
				) {
					res.status(400);
					const err = new Error(
						'Error processing your payment, please contact customer support.'
					);
					res.json({
						message: err.message,
						stack:
							process.env.DEV_MODE === 'production'
								? null
								: err.stack,
					});
					return;
				} else {
					if (response.body.status === 'APPROVED') {
						request.post(
							`https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.paymentDetails.paymentID}/capture`,
							{
								headers: {
									'Content-Type': 'application/json',
								},
								auth: {
									user: process.env.CLIENT_ID,
									pass: process.env.CLIENT_PW,
								},

								json: true,
							},
							asyncHandler(async (err, response) => {
								if (err) {
									res.status(500);
									const err = new Error(
										'Failed to process payment, contact customer support'
									);
									res.json({
										message: err.message,
										stack:
											process.env.DEV_MODE ===
											'production'
												? null
												: err.stack,
									});
									return;
								}
								order.paymentDetails = {
									...order.paymentDetails,
									status: response.body.status,
								};
								await order.save();
								res.json({});
								return;
							})
						);
					}
				}
			})
		);
	} else {
		res.status(404);
		throw new Error(
			'Error retrieving order, please contact customer support'
		);
	}
});

const getOrders = asyncHandler(async (req, res) => {
	try {
	} catch (error) {}
});

const getOrderByID = asyncHandler(async (req, res) => {
	const order = await Order.findById(req.params.id);
	const { capture } = req.body;
	console.log(req.body);
	if (
		order &&
		(req.user._id.toString() === order.userID.toString() || req.user.admin)
	) {
		request.get(
			`https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.paymentDetails.paymentID}`,
			{
				auth: {
					user: process.env.CLIENT_ID,
					pass: process.env.CLIENT_PW,
				},
				json: true,
			},
			asyncHandler(async (err, response) => {
				if (err) {
					res.status(500);
					const err = new Error('An unknown error occurred.');
					res.json({
						message: err.message,
						stack:
							process.env.DEV_MODE === 'production'
								? null
								: err.stack,
					});
					return;
				}
				if (
					response.body.name &&
					response.body.name === 'RESOURCE_NOT_FOUND'
				) {
					request.post(
						'https://api-m.sandbox.paypal.com/v2/checkout/orders',
						{
							auth: {
								user: process.env.CLIENT_ID,
								pass: process.env.CLIENT_PW,
							},
							body: {
								intent: 'CAPTURE',
								purchase_units: [
									{
										amount: {
											value: order.totalPrice.toString(),
											currency_code: 'USD',
										},
									},
								],
							},
							json: true,
						},
						asyncHandler(async (err, response) => {
							if (err) {
								res.status(500);
								const err = new Error(
									'Failed to create order, try again later.'
								);
								res.json({
									message: err.message,
									stack:
										process.env.DEV_MODE === 'production'
											? null
											: err.stack,
								});
								return;
							}
							order.paymentDetails = {
								...order.paymentDetails,
								paymentID: response.body.id,
							};
							await order.save();
							res.json({
								id: order._id,
								name: req.user.name,
								email: req.user.email,
								paymentDetails: order.paymentDetails,
								paymentMethod: order.paymentMethod,
								itemsPrice: order.itemsPrice,
								fees: order.fees,
								totalPrice: order.totalPrice,
								promoCode: order.promoCode,
								orderItems: order.orderItems,
							});
							return;
						})
					);
				} else {
					if (response.body.status === 'APPROVED') {
						order.paymentDetails.status = 'APPROVED';
						await order.save();
					}
					res.json({
						id: order._id,
						name: req.user.name,
						email: req.user.email,
						paymentDetails: order.paymentDetails,
						paymentMethod: order.paymentMethod,
						itemsPrice: order.itemsPrice,
						fees: order.fees,
						totalPrice: order.totalPrice,
						promoCode: order.promoCode,
						orderItems: order.orderItems,
					});
					if (response.body.status === 'APPROVED' && capture) {
						// Capture it after updating client to be ready for next page refresh
						console.log('Capturing after GET');
						request.post(
							`https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.paymentDetails.paymentID}/capture`,
							{
								headers: {
									'Content-Type': 'application/json',
								},
								auth: {
									user: process.env.CLIENT_ID,
									pass: process.env.CLIENT_PW,
								},

								json: true,
							},
							asyncHandler(async (err, response) => {
								if (err) {
									const err = new Error(
										'Failed to process payment, contact customer support'
									);
									console.log(`${err.message}`.red.bold);
									return;
								}
								order.paymentDetails = {
									...order.paymentDetails,
									status: response.body.status,
								};
								await order.save();
							})
						);
					}
				}
			})
		);
	} else {
		res.status(404);
		throw new Error('Unable to retrieve order.');
	}
});

const applyPromo = asyncHandler(async (req, res) => {
	const { promo } = req.body;
	const order = await Order.findById(req.params.id);
	if (order) {
		const promoExists = await PromoCode.findOne({ code: promo });
		if (promoExists) {
			const discount = promoExists.discount;
			const totalPriceUpdated = order.totalPrice * (1 - discount);
			order.totalPrice = totalPriceUpdated;
			order.promoCode = promoExists.code;
			await order.save();
			request.post(
				'https://api-m.sandbox.paypal.com/v2/checkout/orders',
				{
					auth: {
						user: process.env.CLIENT_ID,
						pass: process.env.CLIENT_PW,
					},
					body: {
						intent: 'CAPTURE',
						purchase_units: [
							{
								amount: {
									value: order.totalPrice.toString(),
									currency_code: 'USD',
								},
							},
						],
					},
					json: true,
				},
				asyncHandler(async (err, response) => {
					if (err) {
						res.status(500);
						const err = new Error(
							'Failed to create order, try again later.'
						);
						res.json({
							message: err.message,
							stack:
								process.env.DEV_MODE === 'production'
									? null
									: err.stack,
						});
						return;
					}
					order.paymentDetails = {
						...order.paymentDetails,
						paymentID: response.body.id,
					};
					await order.save();
					res.json({
						id: order._id,
						name: req.user.name,
						email: req.user.email,
						itemsPrice: order.itemsPrice,
						fees: order.fees,
						paymentDetails: order.paymentDetails,
						paymentMethod: order.paymentMethod,
						totalPrice: order.totalPrice,
						oldPrice: order.totalPrice / (1 - discount),
						promoCode: order.promoCode,
						orderItems: order.orderItems,
					});
				})
			);
		} else {
			res.status(404);
			throw new Error(
				`Promo code doesn't exist or has expired, try another one.`
			);
		}
	} else {
		res.status(404);
		throw new Error('Order doesnt exist');
	}
});

const deleteOrderByID = asyncHandler(async (req, res) => {
	try {
	} catch (error) {}
});

const editOrderbyID = asyncHandler(async (req, res) => {
	try {
	} catch (error) {}
});

router
	.route('/userorders')
	.get(protect, getUserOrders)
	.put(protect, createOrder)
	.post(protect, confirmOrder);

router.route('/').get(protect, admin, getOrders);

router.route('/paypal/:id').get(protect, getPaypalOrder);

router.route('/:id/special').post(protect, getOrderByID);

router
	.route('/:id')
	.post(protect, applyPromo)
	.put(protect, admin, editOrderbyID)
	.delete(protect, admin, deleteOrderByID);

export default router;